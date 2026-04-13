import os
import shutil

src = "../ML_implementation/models"
dst = "models"

if not os.path.exists(dst):
    os.makedirs(dst)

if os.path.exists(src):
    for f in os.listdir(src):
        shutil.copy(os.path.join(src, f), os.path.join(dst, f))
    print("Copied real models from ML_implementation.")
else:
    print("Pre-trained models are already mapped or not natively available. Continuing...")
