import { Router } from "express";
import {
  getAvailableDrivers,
  getAvailablePlates,
  getAvailableMonths,
  getDashboardDiagnostics,
  getFuelDashboard,
  getOverviewDashboard,
} from "../services/dashboardService.js";

export const dashboardRouter = Router();

function parseMonthsQuery(rawMonths) {
  if (!rawMonths) {
    return [];
  }

  return String(rawMonths)
    .split(",")
    .map((month) => month.trim())
    .filter(Boolean);
}

dashboardRouter.get("/health", async (_request, response) => {
  response.json({ ok: true });
});

dashboardRouter.get("/plates", async (_request, response, next) => {
  try {
    const data = await getAvailablePlates();
    response.json(data);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/months", async (_request, response, next) => {
  try {
    const data = await getAvailableMonths();
    response.json(data);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/drivers", async (request, response, next) => {
  try {
    const data = await getAvailableDrivers(request.query.placa);
    response.json(data);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/diagnostics", async (_request, response, next) => {
  try {
    const data = await getDashboardDiagnostics(
      parseMonthsQuery(_request.query.months),
      _request.query.categoria,
      _request.query.motorista,
    );
    response.json(data);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/overview", async (request, response, next) => {
  try {
    const data = await getOverviewDashboard(
      request.query.placa,
      parseMonthsQuery(request.query.months),
      request.query.categoria,
    );
    response.json(data);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/fuel", async (request, response, next) => {
  try {
    const data = await getFuelDashboard(
      request.query.placa,
      parseMonthsQuery(request.query.months),
      request.query.motorista,
    );
    response.json(data);
  } catch (error) {
    next(error);
  }
});
