export interface User {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  must_change_password?: boolean;
  rate_limit_rpm?: number | null;
  daily_token_quota?: number | null;
}

export interface UserCreateResult extends User {
  generated_password: string | null;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  auth_mode: string;
  has_api_key: boolean;
  base_url: string | null;
  default_model: string;
  is_active: boolean;
  light_model: string | null;
  heavy_model: string | null;
  route_threshold_tokens: number;
  connected: boolean;
}

export interface Conversation {
  id: string;
  provider_id: string | null;
  model: string;
  title: string;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  tokens: number;
}

export interface PolicyRule {
  id: string;
  name: string;
  category: string;
  kind: string;
  pattern: string;
  action: string;
  severity: string;
  enabled: boolean;
}

export interface Builtin {
  name: string;
  category: string;
  action: string;
  severity: string;
}

export interface Alert {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  rule_name: string;
  category: string;
  action: string;
  severity: string;
  snippet: string;
  resolved: boolean;
  created_at: string;
}

export interface AuditRow {
  id: string;
  user_id: string | null;
  provider_id: string | null;
  model: string | null;
  request_tokens: number;
  response_tokens: number;
  latency_ms: number;
  status_code: number;
  applied_policies: string[];
  error: string | null;
  created_at: string;
}
