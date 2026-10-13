import { describe, expect, test } from "bun:test";
import { rolesToAdd } from "./rolesync.ts";

const rules = [
  { sourceRoleIds: ["a", "b"], targetRoleId: "t1" },
  { sourceRoleIds: ["c"], targetRoleId: "t2" },
];

describe("rolesToAdd", () => {
  test("ソースロールのいずれかを持っていればターゲットを返す", () => {
    expect(rolesToAdd(["b"], rules)).toEqual(["t1"]);
  });

  test("ターゲットを持っていれば返さない", () => {
    expect(rolesToAdd(["a", "t1"], rules)).toEqual([]);
  });

  test("複数のルールに該当すれば全て返す", () => {
    expect(rolesToAdd(["a", "c"], rules)).toEqual(["t1", "t2"]);
  });

  test("ソースロールを持たなければ返さない", () => {
    expect(rolesToAdd(["x"], rules)).toEqual([]);
  });
});
