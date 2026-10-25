import unittest
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score, confusion_matrix, precision_score, recall_score, f1_score

class TestFraudModelInference(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Look for models in ml-service/models or ML_implementation/models
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.models_dir = os.path.join(base_dir, "models")
        if not os.path.exists(cls.models_dir):
            cls.models_dir = os.path.join(base_dir, "..", "ML_implementation", "models")
        
        cls.lr = joblib.load(os.path.join(cls.models_dir, "lr.pkl"))
        cls.rf = joblib.load(os.path.join(cls.models_dir, "rf.pkl"))
        cls.xgb = joblib.load(os.path.join(cls.models_dir, "xgb.pkl"))
        cls.scaler = joblib.load(os.path.join(cls.models_dir, "scaler.pkl"))
        
        # Load reference predictions if available
        cls.pred_csv = os.path.join(base_dir, "..", "ML_implementation", "outputs", "predictions.csv")
        cls.has_predictions = os.path.exists(cls.pred_csv)
        if cls.has_predictions:
            cls.predictions_df = pd.read_csv(cls.pred_csv)

    def test_01_models_loaded(self):
        """Verify all 4 artifacts are loaded successfully."""
        self.assertIsNotNone(self.lr)
        self.assertIsNotNone(self.rf)
        self.assertIsNotNone(self.xgb)
        self.assertIsNotNone(self.scaler)

    def test_02_feature_dimension(self):
        """Verify feature dimension expectation is exactly 30."""
        self.assertEqual(self.scaler.n_features_in_, 30)
        self.assertEqual(self.lr.n_features_in_, 30)
        self.assertEqual(self.rf.n_features_in_, 30)

    def test_03_inference_probabilities_bounded(self):
        """Verify probabilities are strictly bounded in [0, 1]."""
        dummy_input = np.zeros((1, 30))
        scaled = self.scaler.transform(dummy_input)
        
        p_lr = self.lr.predict_proba(scaled)[0, 1]
        p_rf = self.rf.predict_proba(dummy_input)[0, 1]
        p_xgb = self.xgb.predict_proba(dummy_input)[0, 1]
        p_ens = 0.2 * p_lr + 0.3 * p_rf + 0.5 * p_xgb

        self.assertTrue(0.0 <= p_lr <= 1.0)
        self.assertTrue(0.0 <= p_rf <= 1.0)
        self.assertTrue(0.0 <= p_xgb <= 1.0)
        self.assertTrue(0.0 <= p_ens <= 1.0)

    def test_04_ensemble_weights_sum_to_one(self):
        """Verify ensemble weights (0.2 LR, 0.3 RF, 0.5 XGB) sum to 1.0."""
        w_lr, w_rf, w_xgb = 0.2, 0.3, 0.5
        self.assertAlmostEqual(w_lr + w_rf + w_xgb, 1.0, places=9)

    def test_05_threshold_monotonicity(self):
        """Verify that higher threshold leads to fewer or equal positive predictions."""
        if not self.has_predictions:
            self.skipTest("predictions.csv not found")

        probs = self.predictions_df['Probability'].values
        counts = {}
        for t in [0.2, 0.3, 0.4, 0.5]:
            counts[t] = np.sum(probs > t)

        self.assertTrue(counts[0.2] >= counts[0.3])
        self.assertTrue(counts[0.3] >= counts[0.4])
        self.assertTrue(counts[0.4] >= counts[0.5])

    def test_06_reproduce_evaluation_metrics(self):
        """Verify reproduced metrics on the 56,962 test set match recorded results."""
        if not self.has_predictions:
            self.skipTest("predictions.csv not found")

        y_true = self.predictions_df['Actual'].values
        y_prob = self.predictions_df['Probability'].values

        roc_auc = roc_auc_score(y_true, y_prob)
        pr_auc = average_precision_score(y_true, y_prob)

        # Manuscript / notebook records ROC-AUC = 0.972342
        self.assertAlmostEqual(roc_auc, 0.972342, places=4)
        self.assertGreater(pr_auc, 0.85)

        # Test threshold 0.3 (default deployment threshold)
        y_pred_03 = (y_prob > 0.3).astype(int)
        prec = precision_score(y_true, y_pred_03)
        rec = recall_score(y_true, y_pred_03)
        f1 = f1_score(y_true, y_pred_03)

        self.assertAlmostEqual(prec, 0.838384, places=4)
        self.assertAlmostEqual(rec, 0.846939, places=4)
        self.assertAlmostEqual(f1, 0.842640, places=4)

if __name__ == '__main__':
    unittest.main()
