/**
 * 客户端错误文案（任务 005 §8）。
 *
 * 目标：**说人话但不泄密**。
 * 上游返回的错误信息里可能出现接口域名、traceId、内部枚举，
 * 这里统一折算成「发生了什么 + 你可以怎么办」，原始 code 只作为小字标注。
 *
 * 本文件不依赖任何服务端模块，可被 "use client" 组件直接引用。
 */

export interface FriendlyError {
  /** 一句话说清发生了什么（短，可做标题） */
  title: string;
  /** 用户能做的下一步 */
  hint: string;
  /** 原始错误码，仅用于小字标注，帮助排查 */
  code?: string;
  /** 是否值得重试 */
  retryable: boolean;
}

interface ApiErrorBody {
  success?: false;
  error?: { code?: string; message?: string; retryable?: boolean };
  field?: string;
}

const MAX_DETAIL = 120;

/** 兜底：截断 + 去掉疑似凭证片段，避免把内部信息原样铺到界面上 */
export function sanitizeDetail(raw: string | undefined | null): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/[A-Za-z0-9_-]{32,}/g, "***")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > MAX_DETAIL ? `${cleaned.slice(0, MAX_DETAIL)}…` : cleaned;
}

const PRESET: Record<string, Omit<FriendlyError, "code">> = {
  RATE_LIMITED: {
    title: "查得有点快，缓一下",
    hint: "为了避免把门店接口打爆，这里限制了频率。等十几秒再试一次就好。",
    retryable: true,
  },
  MCP_TIMEOUT: {
    title: "门店数据这次没赶上",
    hint: "麦当劳接口响应超时，通常是网络波动。菜单和价格必须实时查，所以这次没有用任何猜测数据顶替。",
    retryable: true,
  },
  MCP_UNAVAILABLE: {
    title: "暂时连不上门店数据",
    hint: "可能是本机网络或上游服务忙。稍后重试；联网状态可以直接看页面右上角的连接标识。",
    retryable: true,
  },
  MENU_UNAVAILABLE: {
    title: "这家门店的菜单没取到",
    hint: "有些门店在某些时段不返回菜单。换一家门店，或稍后再试。",
    retryable: true,
  },
  STORE_UNAVAILABLE: {
    title: "这个商圈没查到门店",
    hint: "把商圈关键词换成更常见的地名（例如：天河、体育西、大学城）再查一次。",
    retryable: false,
  },
  MISSING_TOKEN: {
    title: "这台服务器还没配好数据凭证",
    hint: "服务端缺少麦当劳官方接口的访问凭证，因此查不到真实菜单。系统不会用模拟数据冒充真实结果。",
    retryable: false,
  },
  INVALID_REQUEST: {
    title: "输入有点问题",
    hint: "检查一下金额或文字长度，改一下再提交。",
    retryable: false,
  },
  INTERNAL: {
    title: "服务内部出了点问题",
    hint: "这不是你的操作问题，稍后重试通常就好。",
    retryable: true,
  },
};

function byStatus(status: number): Omit<FriendlyError, "code"> {
  if (status === 429) return PRESET.RATE_LIMITED;
  if (status === 503) return PRESET.MISSING_TOKEN;
  if (status === 504) return PRESET.MCP_TIMEOUT;
  if (status === 502) return PRESET.MCP_UNAVAILABLE;
  if (status === 400 || status === 413) return PRESET.INVALID_REQUEST;
  if (status >= 500) return PRESET.INTERNAL;
  return {
    title: "这次没查成",
    hint: "页面还能继续用，换个条件或稍后重试。",
    retryable: true,
  };
}

/** 把 HTTP 错误响应折算成可读文案 */
export async function readApiError(response: Response): Promise<FriendlyError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const code = body?.error?.code;
  const preset = (code ? PRESET[code] : undefined) ?? byStatus(response.status);
  const detail = sanitizeDetail(body?.error?.message);

  return {
    ...preset,
    code: code ?? `HTTP_${response.status}`,
    retryable: body?.error?.retryable ?? preset.retryable,
    hint: detail && detail !== preset.title ? `${preset.hint}（${detail}）` : preset.hint,
  };
}

/** 网络层失败（fetch 直接抛错、断网、被拦截） */
export function networkError(): FriendlyError {
  return {
    title: "网络好像断了",
    hint: "检查一下网络连接，或确认页面没有被浏览器插件拦截，然后重试。",
    code: "NETWORK",
    retryable: true,
  };
}
