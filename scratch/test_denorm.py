import torch
from torchvision import transforms
from PIL import Image
import numpy as np

# Load a sample image if exists, or create a random one
img = Image.new('RGB', (224, 224), color = (100, 150, 200))

# Apply same transform
normalize = transforms.Normalize(
    mean=[0.485, 0.456, 0.406], 
    std=[0.229, 0.224, 0.225]
)
transform = transforms.Compose([
    transforms.ToTensor(),
    normalize,
])

img_tensor = transform(img)
img_np = img_tensor.cpu().numpy().transpose(1, 2, 0)
print("Before denorm: min =", img_np.min(), "max =", img_np.max())

# Apply denorm
if img_np.min() < 0.0 or img_np.max() > 1.0:
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    img_np = img_np * std + mean
    img_np = np.clip(img_np, 0.0, 1.0)

print("After denorm: min =", img_np.min(), "max =", img_np.max())
print("Expected: ", 100/255.0, 150/255.0, 200/255.0)
print("Actual:   ", img_np[0, 0])
