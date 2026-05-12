import { Router } from "express";
import {
  createQuoteRegistry,
  deleteQuoteRegistry,
  getQuoteRegistrySummary,
  listQuoteRegistryOptions,
  listQuoteRegistry,
  updateQuoteRegistry,
} from "../services/quoteRegistryService.js";

export const quoteRegistryRouter = Router();

quoteRegistryRouter.get("/quote-registry", async (request, response, next) => {
  try {
    const data = await listQuoteRegistry(
      {
        search: request.query.search,
        status: request.query.status,
        customer: request.query.customer,
        origin: request.query.origin,
        destination: request.query.destination,
      },
      request.query.sort,
      request.query.direction,
    );
    response.json(data);
  } catch (error) {
    next(error);
  }
});

quoteRegistryRouter.get("/quote-registry/summary", async (request, response, next) => {
  try {
    const data = await getQuoteRegistrySummary({
      search: request.query.search,
      status: request.query.status,
      customer: request.query.customer,
      origin: request.query.origin,
      destination: request.query.destination,
    });
    response.json(data);
  } catch (error) {
    next(error);
  }
});

quoteRegistryRouter.get("/quote-registry/options", async (request, response, next) => {
  try {
    const data = await listQuoteRegistryOptions();
    response.json(data);
  } catch (error) {
    next(error);
  }
});

quoteRegistryRouter.post("/quote-registry", async (request, response, next) => {
  try {
    const data = await createQuoteRegistry(request.body);
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

quoteRegistryRouter.put("/quote-registry/:id", async (request, response, next) => {
  try {
    const data = await updateQuoteRegistry(request.params.id, request.body);
    response.json(data);
  } catch (error) {
    next(error);
  }
});

quoteRegistryRouter.delete("/quote-registry/:id", async (request, response, next) => {
  try {
    const data = await deleteQuoteRegistry(request.params.id);
    response.json(data);
  } catch (error) {
    next(error);
  }
});
