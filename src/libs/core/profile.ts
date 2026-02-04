import type { Client } from "./type";

export interface ClientProfile extends Client {
  roomId: string;
  password: string | null;
  autoJoin: boolean;
  initalJoin: boolean;
}

