"""Pydantic request/response models."""
from __future__ import annotations

from pydantic import BaseModel, Field

# On-prem deployments commonly use internal domains (.local, .internal, .corp)
# that strict public-email validators reject, so we apply a light format check.
_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


# ---- Auth ----
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ---- Users ----
class UserCreate(BaseModel):
    email: str = Field(pattern=_EMAIL)
    # Optional: when omitted the system generates a temporary password the user
    # must change on first sign-in (returned to the admin to relay).
    password: str | None = Field(default=None, min_length=8)
    role: str = Field(default="user", pattern="^(admin|user)$")
    # Optional per-user limits (null = use gateway default; 0 = unlimited).
    rate_limit_rpm: int | None = Field(default=None, ge=0)
    daily_token_quota: int | None = Field(default=None, ge=0)


class UserUpdate(BaseModel):
    password: str | None = Field(default=None, min_length=8)
    role: str | None = Field(default=None, pattern="^(admin|user)$")
    is_active: bool | None = None
    rate_limit_rpm: int | None = Field(default=None, ge=0)
    daily_token_quota: int | None = Field(default=None, ge=0)


class UserOut(BaseModel):
    id: str
    email: str
    role: str
    is_active: bool
    must_change_password: bool = False
    rate_limit_rpm: int | None = None
    daily_token_quota: int | None = None


class UserCreateResult(UserOut):
    # The system-generated password, returned so the admin can relay it to the
    # user. Null when the admin supplied the password explicitly.
    generated_password: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


# ---- Providers ----
class ProviderCreate(BaseModel):
    name: str
    type: str = Field(pattern="^(openai|anthropic|gemini)$")
    auth_mode: str = Field(default="api_key", pattern="^(api_key|oauth2)$")
    api_key: str | None = None
    oauth_client_id: str | None = None
    oauth_client_secret: str | None = None
    oauth_auth_url: str | None = None
    oauth_token_url: str | None = None
    oauth_scopes: str | None = None
    base_url: str | None = None
    default_model: str
    is_active: bool = True
    # Smart routing (optional)
    light_model: str | None = None
    heavy_model: str | None = None
    route_threshold_tokens: int | None = None


class ProviderUpdate(BaseModel):
    name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    default_model: str | None = None
    is_active: bool | None = None
    light_model: str | None = None
    heavy_model: str | None = None
    route_threshold_tokens: int | None = None


class ProviderOut(BaseModel):
    id: str
    name: str
    type: str
    auth_mode: str
    has_api_key: bool
    base_url: str | None
    default_model: str
    is_active: bool
    light_model: str | None = None
    heavy_model: str | None = None
    route_threshold_tokens: int = 2000
    # For the current user: whether they've connected (oauth2) or added own key.
    connected: bool = False
    own_key: bool = False


# ---- Conversations / messages ----
class ConversationCreate(BaseModel):
    provider_id: str
    model: str | None = None
    title: str = "New conversation"


class ConversationOut(BaseModel):
    id: str
    provider_id: str | None
    model: str
    title: str


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    tokens: int


# ---- Policy rules & alerts ----
class PolicyRuleCreate(BaseModel):
    name: str
    category: str = "custom"
    kind: str = Field(pattern="^(regex|keyword)$")
    pattern: str
    action: str = Field(pattern="^(mask|block|flag)$")
    severity: str = Field(default="medium", pattern="^(low|medium|high)$")
    enabled: bool = True


class PolicyRuleUpdate(BaseModel):
    pattern: str | None = None
    action: str | None = Field(default=None, pattern="^(mask|block|flag)$")
    severity: str | None = Field(default=None, pattern="^(low|medium|high)$")
    enabled: bool | None = None


class PolicyRuleOut(BaseModel):
    id: str
    name: str
    category: str
    kind: str
    pattern: str
    action: str
    severity: str
    enabled: bool


class AlertOut(BaseModel):
    id: str
    user_id: str | None
    conversation_id: str | None
    rule_name: str
    category: str
    action: str
    severity: str
    snippet: str
    resolved: bool
    created_at: str


class ChatRequest(BaseModel):
    content: str


class ChatReply(BaseModel):
    message: MessageOut
    applied_policies: list[str] = []


# ---- User own keys (BYOK) ----
class OwnKeyCreate(BaseModel):
    api_key: str = Field(min_length=1)
    label: str = ""


class OwnKeyOut(BaseModel):
    provider_type: str
    label: str
    created_at: str


# ---- Documents ----
class DocumentOut(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    indexed: bool = False
    team_id: str | None = None
    created_at: str
