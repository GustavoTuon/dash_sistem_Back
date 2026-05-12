import { Router } from "express";
import { calculateFreightQuote, getFreightRates } from "../services/freightService.js";

export const freightRouter = Router();

freightRouter.get("/freight/rates", async (_request, response, next) => {
  try {
    const data = await getFreightRates();
    response.json(data);
  } catch (error) {
    next(error);
  }
});

freightRouter.post("/freight/calculate", async (request, response, next) => {
  try {
    const data = await calculateFreightQuote(request.body);
    response.json(data);
  } catch (error) {
    next(error);
  }
});
