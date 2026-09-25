from fastapi import FastAPI, Body
from typing import Union
import joblib
import numpy as np
import random
import os

app = FastAPI()

# load models
lr = joblib.load("models/lr.pkl")
rf = joblib.load("models/rf.pkl")
xgb = joblib.load("models/xgb.pkl")
scaler = joblib.load("models/scaler.pkl")

# ── Fraud threshold ─────────────────────────────────────────────────────────────
# Configurable via FRAUD_THRESHOLD environment variable.
# Default: 0.3 — preserved from original implementation.
#
# IMPORTANT: Do NOT change this default without updating:
#   1. The Jupyter notebook (ML_implementation/fraud-detection.ipynb)
#   2. Experiment documentation
#   3. The research manuscript
#
# The threshold at deployment MUST match the threshold used in evaluation.
FRAUD_THRESHOLD = float(os.environ.get("FRAUD_THRESHOLD", "0.3"))

@app.post("/predict")
def predict(data: Union[list, dict] = Body(...)):
    try:
        if isinstance(data, dict):
            # SIMULATION MODE: 
            # We take the user's Amount and Generate "Random Evidence" (29 other features)
            # This allows the ML model to actually 'think' and decide if the random pattern is Fraud.
            amount = float(data.get("amount", 0.0))
            
            # Generate 29 random features (Time + V1-V28)
            # We use a range of -5 to 5 to ensure we occasionally hit "Strange" patterns
            random_features = [random.uniform(-5, 5) for _ in range(29)]
            features = random_features + [amount]
        else:
            # ORIGINAL MODE: Use the exact 30 features provided
            features = data

        # Perform inference
        data_scaled = scaler.transform([features])
        lr_p = lr.predict_proba(data_scaled)[0][1]
        rf_p = rf.predict_proba([features])[0][1]
        xgb_p = xgb.predict_proba([features])[0][1]

        prob = (0.2 * lr_p) + (0.3 * rf_p) + (0.5 * xgb_p)

        return {
            "fraud_probability": float(prob),
            "prediction": int(prob > FRAUD_THRESHOLD),
            "threshold_used": FRAUD_THRESHOLD
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/health")
def health():
    return {"status": "OK", "fraud_threshold": FRAUD_THRESHOLD}
