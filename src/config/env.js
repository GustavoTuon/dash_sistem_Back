import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const rootEnvPath = path.resolve(currentDir, "../../../.env");

dotenv.config({ path: rootEnvPath });

export const env = {
  port: Number(process.env.PORT ?? 3333),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  dbHost: process.env.DB_HOST ?? "127.0.0.1",
  dbPort: Number(process.env.DB_PORT ?? 5432),
  dbName: process.env.DB_NAME ?? "",
  dbUser: process.env.DB_USER ?? "",
  dbPassword: process.env.DB_PASSWORD ?? "",
  dbSchema: process.env.DB_SCHEMA ?? "public",
};
