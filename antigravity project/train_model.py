import pandas as pd
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.naive_bayes import MultinomialNB
import pickle
import os

# Training data: Symptoms and their corresponding categories
data = {
    'symptoms': [
        'i have a fever', 'feeling hot and feverish', 'high body temperature', 'fever', 'i have high fever',
        'bad cough', 'dry cough', 'coughing a lot', 'chest congestion and cough', 'persistent cough',
        'runny nose and cold', 'sneezing and cold', 'i have a bad cold', 'chills and cold', 'severe cold',
        'headache', 'my head hurts', 'pain in head', 'throbbing headache', 'slight headache',
        'severe headache', 'migraine', 'heavy head pain', 'intense headache', 'heavy headache',
        'vomiting', 'nausea and vomiting', 'feeling like throwing up', 'sick to stomach and vomiting', 'feeling sick and vomiting',
        'stomach ache', 'pain in stomach', 'abdominal pain', 'stomach cramps', 'stomach pain',
        'body aches', 'muscle pain', 'my body hurts', 'feeling sore all over', 'body pain',
        'skin rash', 'itchy skin', 'red spots on skin', 'rash on arm', 'allergic skin rash',
        'feeling tired', 'extreme fatigue', 'low energy', 'weakness', 'fatigue',
        'acidity', 'heartburn', 'burning sensation in chest', 'sour stomach', 'acid reflux',
        'sore throat and cold', 'pain in throat and cold', 'throat infection with cold', 'cold throat pain',
        'throat pain and cough', 'pain while swallowing and cough', 'cough with throat irritation', 'cough throat pain',
        'chest pain', 'tightness in chest', 'pressure in chest', 'sharp chest pain',
        'heart pain', 'pain near heart', 'discomfort in heart area', 'stabbing heart pain',
        'high blood pressure', 'feeling dizzy with high bp', 'hypertension', 'high bp',
        'low blood pressure', 'feeling faint with low bp', 'hypotension', 'low bp'
    ],
    'label': [
        'fever', 'fever', 'fever', 'fever', 'fever',
        'cough', 'cough', 'cough', 'cough', 'cough',
        'cold', 'cold', 'cold', 'cold', 'cold',
        'headache', 'headache', 'headache', 'headache', 'headache',
        'heavy headache', 'heavy headache', 'heavy headache', 'heavy headache', 'heavy headache',
        'vomiting', 'vomiting', 'vomiting', 'vomiting', 'vomiting',
        'stomach pain', 'stomach pain', 'stomach pain', 'stomach pain', 'stomach pain',
        'body pain', 'body pain', 'body pain', 'body pain', 'body pain',
        'skin rash', 'skin rash', 'skin rash', 'skin rash', 'skin rash',
        'fatigue', 'fatigue', 'fatigue', 'fatigue', 'fatigue',
        'acidity', 'acidity', 'acidity', 'acidity', 'acidity',
        'cold throat pain', 'cold throat pain', 'cold throat pain', 'cold throat pain',
        'cough throat pain', 'cough throat pain', 'cough throat pain', 'cough throat pain',
        'chest pain', 'chest pain', 'chest pain', 'chest pain',
        'heart pain', 'heart pain', 'heart pain', 'heart pain',
        'high bp', 'high bp', 'high bp', 'high bp',
        'low bp', 'low bp', 'low bp', 'low bp'
    ]
}

df = pd.DataFrame(data)

# Vectorize text
vectorizer = CountVectorizer()
X = vectorizer.fit_transform(df['symptoms'])
y = df['label']

# Train Model
model = MultinomialNB()
model.fit(X, y)

# Save the model and vectorizer
if not os.path.exists('model'):
    os.makedirs('model')

with open('model/symptom_model.pkl', 'wb') as f:
    pickle.dump(model, f)

with open('model/vectorizer.pkl', 'wb') as f:
    pickle.dump(vectorizer, f)

print("Model trained and saved successfully in /model directory!")
