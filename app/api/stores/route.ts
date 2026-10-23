/**
 * GET /api/stores?city=广州市&keyword=天河
 *
 * 为「门店选择」提供真实门店列表。只读，不涉及任何写操作。
 *
 * 为什么必须同时传 city 和 keyword：
 * 实测 `query-nearby-stores`（searchType=2）在**只给 city 不给 keyword** 时
 * 直接返回业务失败 `600058 城市名或者关键词不能为空`，
 * 所以这里把 keyword 也设为必填，并把上游原话作为错误提示回传，
 * 而不是自己编一个"附近门店"的假列表。
 */

import { connection } from "next/server";

import { errorBody, json, toErrorResponse, withDeadline } from "@/lib/api/http";
import { checkRateLimit, clientKey } from "@/lib/api/rate-limit";
import { getMealProvider } from "@/lib/providers/meal-provider";

const RATE_LIMIT = 30;
const DEADLINE_MS = 20_000;

export async function GET(request: Request): Promise<Response> {
  await connection();

  const limit = checkRateLimit(clientKey(request, "stores"), { limit: RATE_LIMIT });
  if (!limit.allowed) {
    return json(
      errorBody("RATE_LIMITED", `请求过于频繁，请 ${limit.retryAfterSec} 秒后再试`, true),
      429,
      { "retry-after": String(limit.retryAfterSec) },
    );
  }

  const url = new URL(request.url);
  const city = (url.searchParams.get("city") ?? "").trim();
  const keyword = (url.searchParams.get("keyword") ?? "").trim();

  if (!city || city.length > 20) {
    return json(errorBody("INVALID_REQUEST", "city 不能为空且不超过 20 字", false), 400);
  }
  if (!keyword || keyword.length > 30) {
    return json(
      errorBody(
        "INVALID_REQUEST",
        "keyword（商圈/地标，如「天河」）必填——上游麦当劳接口只给城市时无法查询门店",
        false,
      ),
      400,
    );
  }

  try {
    const provider = getMealProvider();
    const stores = await withDeadline(
      provider.findStores({ city, keyword, beType: 1, searchType: 2 }),
      DEADLINE_MS,
    );

    return json({
      success: true,
      city,
      keyword,
      count: stores.length,
      stores,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
