import os
import requests
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session
from flask_bcrypt import Bcrypt
import google.generativeai as genai
from google.auth.transport.requests import Request
from google.oauth2 import service_account

app = Flask(__name__)
app.config['SECRET_KEY'] = 'smart-health-secure-secret-key-123'
bcrypt = Bcrypt(app)

# --- Firebase REST Client ---
class FirestoreREST:
    def __init__(self, key_path):
        self.key_path = key_path
        self.project_id = None
        self.token = None
        self.base_url = None
        
        if os.path.exists(key_path):
            with open(key_path) as f:
                data = json.load(f)
                self.project_id = data['project_id']
            self.credentials = service_account.Credentials.from_service_account_file(
                key_path,
                scopes=['https://www.googleapis.com/auth/datastore']
            )
            self.base_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents"
            print(f"Firestore REST initialized for project: {self.project_id}")
        else:
            print("Warning: serviceAccountKey.json not found.")

    def get_token(self):
        self.credentials.refresh(Request())
        return self.credentials.token

    def _get_headers(self):
        return {
            "Authorization": f"Bearer {self.get_token()}",
            "Content-Type": "application/json"
        }

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
GEMINI_API_KEY = "AIzaSyDQemQQ_HDVJJIbJCf9PsjgaWFE1CK70bA"
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-flash-latest')

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
    try:
        response = model.generate_content(user_message)
        return jsonify({'reply': response.text, 'status': 'success'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)
