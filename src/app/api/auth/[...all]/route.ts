import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth/runtime";

export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);
