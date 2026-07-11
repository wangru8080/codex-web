import { describe, expect, it } from "vitest";

import {
  createThreadTurnsListFailureInterceptor,
  createThreadTurnsListFailureInterceptorFromEnv,
  failThreadTurnsListOnCallEnvName,
} from "./thread-turns-list-failure-interceptor";

describe("thread-turns-list-failure-interceptor", () => {
  it("只在指定调用次数拦截 thread/turns/list", () => {
    const interceptor = createThreadTurnsListFailureInterceptor({
      failOnCall: 2,
      message: "分页失败",
    });

    expect(interceptor({ id: 1, method: "thread/read", params: {} })).toBeNull();
    expect(interceptor({ id: 2, method: "thread/turns/list", params: {} })).toBeNull();
    expect(interceptor({ id: 3, method: "thread/turns/list", params: {} })).toEqual({
      id: 3,
      error: {
        code: -32000,
        message: "分页失败",
      },
    });
    expect(interceptor({ id: 4, method: "thread/turns/list", params: {} })).toBeNull();
  });

  it("不会拦截 notification 或 response", () => {
    const interceptor = createThreadTurnsListFailureInterceptor({ failOnCall: 1 });

    expect(interceptor({ method: "thread/turns/list", params: {} })).toBeNull();
    expect(interceptor({ id: 1, result: {} })).toBeNull();
  });

  it("默认和非法 env 不创建失败注入拦截器", () => {
    expect(createThreadTurnsListFailureInterceptorFromEnv({})).toBeUndefined();
    expect(
      createThreadTurnsListFailureInterceptorFromEnv({
        [failThreadTurnsListOnCallEnvName]: "0",
      }),
    ).toBeUndefined();
    expect(
      createThreadTurnsListFailureInterceptorFromEnv({
        [failThreadTurnsListOnCallEnvName]: "abc",
      }),
    ).toBeUndefined();
  });

  it("只有正整数 env 会创建测试专用失败注入拦截器", () => {
    const interceptor = createThreadTurnsListFailureInterceptorFromEnv({
      [failThreadTurnsListOnCallEnvName]: "1",
    });

    expect(interceptor?.({ id: 1, method: "thread/turns/list", params: {} })).toEqual({
      id: 1,
      error: {
        code: -32000,
        message: "Phase 6R 模拟 thread/turns/list 失败",
      },
    });
  });
});
