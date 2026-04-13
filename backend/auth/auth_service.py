import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
import re


class AuthService:
    def __init__(self, db, secret_key: str):
        self.db = db
        self.secret_key = secret_key

    def register_user(self, email: str, password: str, username: str, full_name: str) -> Dict:
        """Register new user with hashed password, username, and full name"""
        if not email or not password or not username or not full_name:
            raise ValueError("All fields are required")

        email = email.lower().strip()

        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Invalid email format")

        if len(username) < 3:
            raise ValueError("Username must be at least 3 characters")

        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters")

        if not re.match(r"^[a-zA-Z0-9_\-\.]+$", username):
            raise ValueError("Username may only contain letters, numbers, underscores, hyphens and dots")

        password_hash = bcrypt.hashpw(
            password.encode('utf-8'),
            bcrypt.gensalt()
        )

        try:
            user_id = self.db.create_user(email, password_hash, username, full_name)
        except ValueError as e:
            raise e

        return {
            "user_id": user_id,
            "email": email,
            "username": username,
            "full_name": full_name
        }

    def login(self, email: str, password: str) -> Optional[str]:
        """Authenticate user and return JWT token"""
        email = email.lower().strip()
        user = self.db.get_user_by_email(email)

        if not user:
            return None

        if not bcrypt.checkpw(
                password.encode('utf-8'),
                user['password_hash'].encode('utf-8')
        ):
            return None

        self.db.update_last_login(user['id'])

        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'username': user.get('username', 'user'),
            'full_name': user.get('full_name', 'User'),
            'exp': datetime.now(timezone.utc) + timedelta(days=7)
        }

        token = jwt.encode(payload, self.secret_key, algorithm='HS256')
        return token

    def verify_token(self, token: str) -> Optional[Dict]:
        """Verify JWT token and return user data"""
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=['HS256']
            )
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None

    def get_user_info(self, user_id: int) -> Optional[Dict]:
        """Get user info by ID"""
        user = self.db.get_user_by_id(user_id)
        if not user:
            return None

        return {
            'user_id': user['id'],
            'email': user['email'],
            'username': user.get('username', 'user'),
            'full_name': user.get('full_name', 'User'),
        }