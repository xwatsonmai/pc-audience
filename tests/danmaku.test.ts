import { describe, expect, it } from "vitest";
import { isSafeDanmakuText, selectSafeDanmaku } from "../src/shared/safety";

describe("danmaku safety", () => {
  it("blocks insulting text", () => {
    expect(isSafeDanmakuText("你这个废物")).toBe(false);
    expect(isSafeDanmakuText("写了八分钟就开始奖励自己")).toBe(true);
  });

  it("blocks machine flavored debug wording", () => {
    expect(isSafeDanmakuText("连续 idle 24 轮了")).toBe(false);
    expect(isSafeDanmakuText("任务未设置，难怪在发呆")).toBe(false);
    expect(isSafeDanmakuText("鼠标悬停在空白区域")).toBe(false);
    expect(isSafeDanmakuText("Confidence is too low this round")).toBe(false);
    expect(isSafeDanmakuText("Task relation says off task")).toBe(false);
    expect(isSafeDanmakuText("Mouse hovering in the blank area again")).toBe(false);
    expect(isSafeDanmakuText("先喝口水，剧情慢慢来")).toBe(true);
    expect(isSafeDanmakuText("Grab some water, this plot can simmer")).toBe(true);
  });

  it("dedupes recent messages and limits output", () => {
    const selected = selectSafeDanmaku(
      [{ text: "回来写方案" }, { text: "回来写方案" }, { text: "这个切换有点丝滑" }],
      [{ text: "回来写方案" }],
      2,
    );
    expect(selected).toEqual([{ text: "这个切换有点丝滑" }]);
  });

  it("dedupes near repeated messages", () => {
    const selected = selectSafeDanmaku(
      [
        { text: "我先记一笔这个切换看起来有点故事" },
        { text: "项目经理开始看时间线了", speaker: "项目经理" },
        { text: "切回任务了，这段可以续上" },
      ],
      [{ text: "我先记一笔：这个切换看起来有点故事。" }],
      3,
    );
    expect(selected).toEqual([
      { text: "项目经理开始看时间线了" },
      { text: "切回任务了，这段可以续上" },
    ]);
  });

  it("keeps silence when there are no usable candidates", () => {
    expect(selectSafeDanmaku([], [], 6)).toEqual([]);
    expect(selectSafeDanmaku([{ text: "你这个废物" }], [], 6)).toEqual([]);
  });
});
