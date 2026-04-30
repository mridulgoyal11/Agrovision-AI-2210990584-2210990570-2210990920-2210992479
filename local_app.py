import os
import sys
import base64
import io
import pathlib
import platform
import traceback
import pickle
from types import ModuleType
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# --- THE UNIVERSAL BRIDGE: PYTHON 3.13 + LEGACY FASTAI MODELS ---
# This version uses a custom Unpickler to map old class paths to new ones.

# 1. SHIM: Standard library removals in Python 3.13
for mod_name in ["imghdr", "distutils", "distutils.util"]:
    if mod_name not in sys.modules:
        m = ModuleType(mod_name)
        if mod_name == "imghdr": m.what = lambda *args, **kwargs: None
        elif mod_name == "distutils.util": m.strtobool = lambda v: v.lower() in ('y', 'yes', 't', 'true', 'on', '1')
        sys.modules[mod_name] = m

# 2. Pathlib compatibility for cross-OS models
if platform.system() == 'Linux':
    pathlib.WindowsPath = pathlib.PosixPath
else:
    pathlib.PosixPath = pathlib.WindowsPath

# 3. Define legacy shims that were removed in modern fastai
import torch

# CastToTensor was a Callback in old fastai, not a Module.
# Making it a simple object avoids PyTorch's internal __call__ checks.
class CastToTensor:
    def __init__(self, *args, **kwargs): pass
    def __call__(self, *args, **kwargs): return None
    def __setstate__(self, state): pass
    def before_batch(self): pass

class LegacyTypeDispatch(dict):
    def __init__(self, *args, **kwargs): super().__init__()
    def __call__(self, *args, **kwargs): return args[0]
    def add(self, *args): pass
    def __setstate__(self, state): pass

class LegacyPipeline:
    def __init__(self, *args, **kwargs): self.fs = []
    def __call__(self, x, **kwargs): return x
    def decode(self, x, **kwargs): return x

# 4. CUSTOM UNPICKLER: The "Magic" that maps 2022 paths to 2025 paths
class UniversalUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        # Map specific missing items
        if name == 'CastToTensor': return CastToTensor
        if name == 'TypeDispatch': return LegacyTypeDispatch
        if name == 'typedispatch': return lambda f: f
        
        # Map Pipeline to its new home
        if name == 'Pipeline' and (module == 'fastcore.transform' or module == 'fasttransform.transform'):
            try:
                from fasttransform import Pipeline
                return Pipeline
            except ImportError: return LegacyPipeline
        
        # Handle rebuilding helpers
        if name == '_rebuild_from_type':
            def _rebuild_from_type(func, type, args, dict):
                obj = func(*args)
                if dict: obj.__dict__.update(dict)
                return obj
            return _rebuild_from_type
            
        # Fallback to standard lookup
        try:
            return super().find_class(module, name)
        except (ImportError, AttributeError):
            # If a module exists but doesn't have the class, return a dummy if it looks like a fastcore transformation
            if module.startswith('fastcore') or module.startswith('fastai'):
                print(f"Shim: Providing robust dummy for {module}.{name}")
                class RobustDummy:
                    def __init__(self, *args, **kwargs): pass
                    def __call__(self, x, *args, **kwargs): return x
                    def decode(self, x, *args, **kwargs): return x
                    def encodes(self, x, *args, **kwargs): return x
                    def decodes(self, x, *args, **kwargs): return x
                    def setup(self, *args, **kwargs): pass
                RobustDummy.__name__ = name
                return RobustDummy
            raise

# 5. Overload torch.load to use our Magic Unpickler
import torch
_orig_torch_load = torch.load

def universal_torch_load(f, map_location=None, pickle_module=pickle, **kwargs):
    # We ignore the passed pickle_module and use our own
    class MockPickle:
        @staticmethod
        def load(file): return UniversalUnpickler(file).load()
        Unpickler = UniversalUnpickler
    
    # We must allow weights_only=False because these are full Learner objects
    kwargs['weights_only'] = False
    return _orig_torch_load(f, map_location=map_location, pickle_module=MockPickle, **kwargs)

torch.load = universal_torch_load

# --- FLASK APP ---

app = Flask(__name__)
CORS(app)

LOAD_ERROR = None
learn = None

def load_model():
    global learn, LOAD_ERROR
    if learn is not None: return True
    
    MODEL_PATHS = ['deployments/models/model6-90%.pkl', 'deployments/models/model3-86_.pkl']
    
    for path in MODEL_PATHS:
        if not os.path.exists(path): continue
        try:
            print(f"Attempting universal load of: {path}")
            # Import fastai lazily to speed up initial server bind
            import torch
            from fastai.vision.all import load_learner
            
            # Using torch.load directly with our overloaded version
            learn = torch.load(path, map_location='cpu')
            
            if hasattr(learn, 'dls'):
                learn.dls.cpu()
                print(f"SUCCESS: Model loaded with Universal Bridge from {path}")
                LOAD_ERROR = None
                return True
        except Exception as e:
            msg = f"Universal Bridge failed for {path}: {str(e)}"
            print(msg)
            traceback.print_exc()
            LOAD_ERROR = msg
    return False

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/style.css')
def style():
    return send_from_directory('.', 'style.css')

@app.route('/insect.png')
def icon():
    return send_from_directory('.', 'insect.png')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ready" if learn else "loading",
        "model_loaded": learn is not None,
        "error": LOAD_ERROR,
        "python_version": sys.version
    })

@app.route('/predict', methods=['GET', 'POST', 'OPTIONS'])
def predict():
    if request.method == 'OPTIONS':
        return '', 200
    if request.method == 'GET':
        return jsonify({"error": "This endpoint requires a POST request with image data.", "suggestion": "If you are seeing this in your browser, it means the frontend is incorrectly trying to 'GET' the results instead of 'POSTing' the image."}), 405
    
    # Lazy load the model on first request
    if learn is None:
        print("Lazy loading model on first request...")
        load_model()
        
    if learn is None:
        return jsonify({"error": "Model not loaded.", "details": LOAD_ERROR}), 500
    try:
        data = request.json
        img_data = data['data'][0]
        if ',' in img_data: img_data = img_data.split(',')[1]
        img_bytes = base64.b64decode(img_data)
        
        from fastai.vision.all import PILImage
        img = PILImage.create(io.BytesIO(img_bytes))
        
        # Inference
        pred, pred_idx, probs = learn.predict(img)
        
        vocab = learn.dls.vocab if hasattr(learn, 'dls') and hasattr(learn.dls, 'vocab') else []
        confidences = [{"label": str(vocab[i]), "confidence": float(probs[i])} for i in range(len(vocab))]
        
        return jsonify({
            "data": [{
                "label": str(pred).upper(),
                "confidences": confidences
            }]
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting 'Universal Bridge' Backend on port {port} (Python {sys.version.split()[0]})")
    app.run(host='0.0.0.0', port=port)
