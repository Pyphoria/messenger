export interface Device {
  id: string;
  user_id: string;
  device_name?: string;
  public_key: string;
  signed_prekey?: string;
  prekeys?: string[]; // as base64 strings in JSONB
  last_seen?: string;
  created_at?: string;
}