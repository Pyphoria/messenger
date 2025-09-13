export interface User {
  id: string;
  username: string;
  email?: string;
  password_hash: string;
  created_at?: string;
}