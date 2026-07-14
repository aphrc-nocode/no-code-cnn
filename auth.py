from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path
import uuid
import json
import hashlib
import hmac
import os
from jose import jwt, JWTError
from fastapi import Request, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Security configurations
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "replace_this_with_a_secure_random_string_1234567890")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
DEFAULT_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

security_scheme = HTTPBearer(auto_error=False)

# Password hashing helper (PBKDF2-HMAC-SHA256, 100k iterations)
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"{salt.hex()}:{key.hex()}"

def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, key_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
        new_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
        return hmac.compare_digest(key, new_key)
    except Exception:
        return False

# Token generation helper
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# User Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    email: str
    password_hash: str
    role: str = "user"  # "user" | "admin"
    status: str = "pending"  # "pending" | "approved" | "rejected"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    role: str
    status: str
    created_at: datetime

# User Persistence Manager
class UserManager:
    def __init__(self):
        self.users: Dict[str, User] = {}
        self.registry_file = Path(__file__).resolve().parent / "logs" / "users.json"
        self._load_users()
        self._bootstrap_admin()

    def _load_users(self):
        if self.registry_file.exists():
            try:
                with open(self.registry_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        # Parse datetime
                        if "created_at" in v and isinstance(v["created_at"], str):
                            v["created_at"] = datetime.fromisoformat(v["created_at"])
                        self.users[k] = User(**v)
            except Exception as e:
                print(f"Error loading users: {e}")

    def save_users(self):
        self.registry_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.registry_file, "w", encoding="utf-8") as f:
            # Dump to dictionary, serializing datetime to string
            serialized = {}
            for k, u in self.users.items():
                u_dict = u.dict()
                u_dict["created_at"] = u.created_at.isoformat()
                serialized[k] = u_dict
            json.dump(serialized, f, indent=2)

    def _bootstrap_admin(self):
        # Create default super user admin if no admin exists
        has_admin = any(u.role == "admin" for u in self.users.values())
        if not has_admin:
            print("Bootstrapping default super user admin...")
            admin_user = User(
                id=str(uuid.uuid4()),
                username="admin",
                email="admin@maklens.com",
                password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
                role="admin",
                status="approved",
                created_at=datetime.utcnow()
            )
            self.create_user(admin_user)

    def get_user_by_username(self, username: str) -> Optional[User]:
        for u in self.users.values():
            if u.username.lower() == username.lower():
                return u
        return None

    def get_user_by_email(self, email: str) -> Optional[User]:
        for u in self.users.values():
            if u.email.lower() == email.lower():
                return u
        return None

    def create_user(self, user: User) -> User:
        self.users[user.id] = user
        self.save_users()
        return user

    def list_users(self) -> List[User]:
        return sorted(list(self.users.values()), key=lambda u: u.created_at, reverse=True)

user_manager = UserManager()

# FastAPI Dependencies for authentication
def get_token(
    request: Request,
    header_creds: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> str:
    # 1. Check Bearer Authorization header
    if header_creds:
        return header_creds.credentials
    # 2. Check Cookie header (for static apps)
    token = request.cookies.get("maklens_token")
    if token:
        return token
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated. Access token missing."
    )

async def get_current_user(token: str = Depends(get_token)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = user_manager.users.get(user_id)
    if user is None:
        raise credentials_exception
    return user

async def get_current_approved_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your account status is '{current_user.status}' and requires admin approval."
        )
    return current_user

async def get_admin_user(current_user: User = Depends(get_current_approved_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation restricted to administrator access."
        )
    return current_user
