import os
import requests
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session
from flask_bcrypt import Bcrypt
try:
    from google import genai as genai_new
    _genai_available = True
except ImportError:
    _genai_new = None
    _genai_available = False

app = Flask(__name__)
app.config['SECRET_KEY'] = 'smart-health-secure-secret-key-123'
bcrypt = Bcrypt(app)

# --- Firebase REST Client ---
class FirestoreREST:
    def __init__(self, key_path):
        self.key_path = key_path
        self.project_id = None
        self.credentials = None
        self.base_url = None
        self._use_auth = False  # Tracks whether auth is available

        # Try to load project_id from key file
        if os.path.exists(key_path):
            try:
                with open(key_path) as f:
                    data = json.load(f)
                    self.project_id = data.get('project_id')

                # Try to load service account credentials
                try:
                    from google.oauth2 import service_account as sa
                    from google.auth.transport.requests import Request as GRequest
                    self.credentials = sa.Credentials.from_service_account_file(
                        key_path,
                        scopes=['https://www.googleapis.com/auth/datastore']
                    )
                    # Test if token refresh works
                    self.credentials.refresh(GRequest())
                    self._use_auth = True
                    print(f"[Firestore] Auth OK. Project: {self.project_id}")
                except Exception as e:
                    self.credentials = None
                    self._use_auth = False
                    print(f"[Firestore] Service account token failed ({e}). Using public access.")

            except Exception as e:
                print(f"[Firestore] Failed to read key file: {e}. Using public access.")
        else:
            print("[Firestore] serviceAccountKey.json not found. Using public access.")

        # Public access uses a hardcoded project ID if the key couldn't be loaded
        if not self.project_id:
            self.project_id = "smart-healthcare-ac042"

        self.base_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents"
        print(f"[Firestore] Base URL set for project: {self.project_id}")

    def _get_headers(self):
        headers = {"Content-Type": "application/json"}
        if self._use_auth and self.credentials:
            try:
                from google.auth.transport.requests import Request as GRequest
                if not self.credentials.valid:
                    self.credentials.refresh(GRequest())
                headers["Authorization"] = f"Bearer {self.credentials.token}"
            except Exception:
                pass  # Fall back to public access silently
        return headers

    def _format_fields(self, data):
        formatted = {}
        for k, v in data.items():
            if isinstance(v, str): formatted[k] = {"stringValue": v}
            elif isinstance(v, bool): formatted[k] = {"booleanValue": v}
            elif isinstance(v, (int, float)): formatted[k] = {"doubleValue": float(v)}
            elif isinstance(v, datetime): formatted[k] = {"timestampValue": v.isoformat() + "Z"}
            else: formatted[k] = {"stringValue": str(v)}
        return {"fields": formatted}

    def _parse_fields(self, fields):
        parsed = {}
        for k, v in fields.items():
            if "stringValue" in v: parsed[k] = v["stringValue"]
            elif "booleanValue" in v: parsed[k] = v["booleanValue"]
            elif "doubleValue" in v: parsed[k] = float(v["doubleValue"])
            elif "integerValue" in v: parsed[k] = int(v["integerValue"])
            elif "timestampValue" in v: 
                ts_str = v["timestampValue"].replace("Z", "")
                try: parsed[k] = datetime.fromisoformat(ts_str)
                except: parsed[k] = ts_str
        return parsed

    def add(self, collection, data):
        url = f"{self.base_url}/{collection}"
        payload = self._format_fields(data)
        resp = requests.post(url, headers=self._get_headers(), json=payload)
        return resp.json()

    def set(self, collection, doc_id, data):
        url = f"{self.base_url}/{collection}/{doc_id}"
        payload = self._format_fields(data)
        resp = requests.patch(url, headers=self._get_headers(), json=payload)
        return resp.json()

    def get(self, collection, doc_id):
        url = f"{self.base_url}/{collection}/{doc_id}"
        resp = requests.get(url, headers=self._get_headers())
        if resp.status_code == 200:
            return self._parse_fields(resp.json().get("fields", {}))
        return None

    def stream(self, collection):
        url = f"{self.base_url}/{collection}"
        resp = requests.get(url, headers=self._get_headers())
        if resp.status_code == 200:
            docs = resp.json().get("documents", [])
            return [self._parse_fields(d.get("fields", {})) for d in docs]
        return []

    def query(self, collection, filters=None):
        # Basic implementation of where filter via structuredQuery
        url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:runQuery"
        
        query = {
            "structuredQuery": {
                "from": [{"collectionId": collection}]
            }
        }
        
        if filters:
            # Example filter: {"field": "userId", "op": "EQUAL", "value": "..."}
            where = {"fieldFilter": {
                "field": {"fieldPath": filters["field"]},
                "op": filters["op"],
                "value": {"stringValue": filters["value"]}
            }}
            query["structuredQuery"]["where"] = where

        resp = requests.post(url, headers=self._get_headers(), json=query)
        if resp.status_code == 200:
            results = resp.json()
            parsed = []
            for r in results:
                if "document" in r:
                    parsed.append(self._parse_fields(r["document"].get("fields", {})))
            return parsed
        return []

db = FirestoreREST('serviceAccountKey.json')

# --- AI Configuration ---
# IMPORTANT: Replace this API key with a valid one from https://aistudio.google.com/apikey
GEMINI_API_KEY = "AIzaSyDQemQQ_HDVJJIbJCf9PsjgaWFE1CK70bA"

_ai_client = None
if _genai_available:
    try:
        _ai_client = genai_new.Client(api_key=GEMINI_API_KEY)
        print("[AI] Gemini client initialized.")
    except Exception as e:
        print(f"[AI] Failed to initialize Gemini client: {e}")

def _fallback_chat(message):
    """Rule-based health chatbot fallback when Gemini API is unavailable."""
    msg = message.lower()
    if any(w in msg for w in ['hi', 'hello', 'hey']):
        return "Hello! I am your AI Health Assistant. How are you feeling today?"
    elif any(w in msg for w in ['fever', 'temperature', 'hot']):
        return "**Fever:** Stay hydrated and rest. Take Paracetamol 650mg if temperature exceeds 100°F. If fever lasts more than 3 days or exceeds 103°F, please consult a doctor immediately."
    elif any(w in msg for w in ['headache', 'head pain', 'migraine']):
        return "**Headache:** Rest in a quiet, dark room and drink water. A mild pain reliever like Dart or Saridon may help. If headache is severe or persistent, please see a doctor."
    elif any(w in msg for w in ['cough', 'cold', 'sneeze', 'runny nose']):
        return "**Cold/Cough:** Stay warm, drink hot fluids, and inhale steam. Medicines like Levocetrizine or Sinarest can help. Avoid cold drinks and dusty areas."
    elif any(w in msg for w in ['stomach', 'vomit', 'nausea', 'abdomen', 'gastric', 'acidity']):
        return "**Stomach Issues:** Eat light food and stay hydrated with ORS or coconut water. MeftalSpas helps with stomach pain, and Vomikind for nausea. Avoid spicy or oily food."
    elif any(w in msg for w in ['body pain', 'muscle pain', 'pain']):
        return "**Body Pain:** Rest well and avoid strenuous activity. Zerodol-P or Combiflam can help. Apply warm compress to sore areas. If pain is severe or chest-related, please seek immediate medical help."
    elif any(w in msg for w in ['bp', 'blood pressure', 'hypertension']):
        return "**Blood Pressure:** Reduce salt intake, avoid stress, and exercise regularly. Take prescribed medication consistently. Monitor BP daily and consult your doctor regularly."
    elif any(w in msg for w in ['diabetes', 'sugar', 'glucose']):
        return "**Diabetes:** Follow your prescribed diet plan, exercise regularly, monitor blood sugar, and take medications as directed. Regular doctor visits are essential."
    elif any(w in msg for w in ['medicine', 'dose', 'dosage', 'drug']):
        return "Use the **Explore Symptoms** feature on the home screen to get personalized medicine recommendations for your symptoms."
    elif any(w in msg for w in ['doctor', 'hospital', 'clinic', 'emergency']):
        return "For a medical emergency, please call 108 (India Emergency). Use the **Nearby Stores** feature to find the nearest pharmacy or clinic."
    elif any(w in msg for w in ['thank', 'thanks', 'bye', 'goodbye']):
        return "You're welcome! Stay healthy and take care! 💚 Remember to drink enough water and rest well."
    elif any(w in msg for w in ['symptom', 'sick', 'ill', 'unwell', 'feeling']):
        return "Please describe your specific symptoms (e.g., fever, headache, cough) and I can guide you better. Or use the **Explore Symptoms** feature for a detailed recommendation."
    else:
        return "I'm your Health Assistant. You can ask me about common symptoms like fever, headache, cold, cough, body pain, or acidity. For specific medicine recommendations, use the **Explore Symptoms** feature."

@app.route('/')
def index():
    return render_template('index2.html')

@app.route('/api/me', methods=['GET'])
def get_current_user():
    if 'user_id' in session:
        return jsonify({'logged_in': True, 'mobile': session['user_id']}), 200
    return jsonify({'logged_in': False}), 200

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    mobile = data.get('mobile')
    password = data.get('password')
    
    if db.get('users', mobile):
        return jsonify({'error': 'Mobile number already registered'}), 400
        
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    db.set('users', mobile, {
        'mobile': mobile,
        'password_hash': hashed_password,
        
        'created_at': datetime.utcnow()
    })
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    mobile = data.get('mobile')
    password = data.get('password')
    
    user_data = db.get('users', mobile)
    if user_data and bcrypt.check_password_hash(user_data['password_hash'], password):
        session['user_id'] = mobile
        return jsonify({'message': 'Login successful'}), 200
    
    return jsonify({'error': 'Invalid mobile number or password'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({'message': 'Logged out successfully'}), 200

@app.route('/api/analyze', methods=['POST'])
def analyze_symptoms():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    data = request.json
    symptoms = data.get('symptoms', '').lower()
    
    medicines = db.stream('medicines')
    medicines.sort(key=lambda m: len(m.get('symptom_keyword', '')), reverse=True)
    
    matched_med = None
    for med in medicines:
        keyword = med.get('symptom_keyword', '').lower()
        if keyword and keyword in symptoms:
            matched_med = med
            break
            
    if matched_med:
        result = {
            'illness': ("Condition related to " + matched_med['symptom_keyword']).title(),
            'medicine': matched_med['medicine_name'],
            'how': matched_med['instructions'],
            'when': 'Use as per dosage instructions',
            'precautions': matched_med['precautions']
        }
    else:
        result = {'illness': 'General', 'medicine': 'Basic Care', 'how': 'Consult doctor', 'when': 'N/A', 'precautions': 'Rest'}
        
    db.add('searchHistory', {
        'userId': session['user_id'],
        'symptom': symptoms,
        'medicine': result['medicine'],
        'timestamp': datetime.utcnow()
    })
    
    return jsonify(result), 200

@app.route('/api/history', methods=['GET'])
def get_history():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    histories = db.query('searchHistory', {"field": "userId", "op": "EQUAL", "value": session['user_id']})
    
    records = []
    for h in histories:
        ts = h.get('timestamp')
        date_str = ts.strftime('%b %d, %Y, %I:%M %p') if isinstance(ts, datetime) else str(ts)
        records.append({'symptom': h.get('symptom'), 'medicine': h.get('medicine'), 'date': date_str, 'raw_date': ts})
    
    # Sort records newest first
    def get_date(x):
        d = x['raw_date']
        if isinstance(d, datetime): return d
        try: return datetime.fromisoformat(str(d).replace('Z', ''))
        except: return datetime.min

    records.sort(key=get_date, reverse=True)
    
    # Remove raw_date before sending
    for r in records: r.pop('raw_date', None)

    return jsonify(records), 200

@app.route('/api/chat', methods=['POST'])
def chat_with_ai():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.json
    user_message = data.get('message', '')

    # Try Gemini AI first
    if _ai_client:
        try:
            response = _ai_client.models.generate_content(
                model='gemini-2.0-flash',
                contents=f"You are a helpful health assistant. Answer health-related questions concisely and helpfully. User message: {user_message}"
            )
            return jsonify({'reply': response.text, 'status': 'success'}), 200
        except Exception as e:
            print(f"[AI] Gemini API error: {e}. Using fallback.")

    # Fallback: rule-based health responses
    reply = _fallback_chat(user_message)
    return jsonify({'reply': reply, 'status': 'fallback'}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5001)
