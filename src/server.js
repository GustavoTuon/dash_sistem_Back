import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { dashboardRouter } from "./routes/dashboardRoutes.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.frontendOrigin.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin nao permitida pelo CORS."));
    },
  }),
);
app.use(express.json());

app.use("/api", dashboardRouter);

app.use((error, _request, response, _next) => {
  console.error(error);

  response.status(500).json({
    message: "Nao foi possivel processar a solicitacao.",
  });
});

app.listen(env.port, () => {
  console.log(`Backend Rodobach rodando na porta ${env.port}`);
});
