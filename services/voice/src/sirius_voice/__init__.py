"""Local push-to-talk voice for Sirius."""

import os

# Set here because they must exist before these libraries initialise, and any import of this
# package runs this first. onnxruntime otherwise reports to Microsoft (spec section 4.2,
# ADR-10: nothing here leaves the machine). The runtime API alone does not stop it.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
