// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { addUser } from "../src/core/add-user.js";

test("addUser defaults working hours to scheduled weekdays from 07:00 to 18:00", () => {
  const user = addUser({
    label: "default-hours-user",
    owner: "william"
  });

  assert.equal(user.workingHours.mode, "scheduled");
  assert.equal(user.workingHours.timezone, "America/New_York");
  assert.deepEqual(user.workingHours.weekdays, ["mon", "tue", "wed", "thu", "fri"]);
  assert.equal(user.workingHours.startLocalTime, "07:00");
  assert.equal(user.workingHours.endLocalTime, "18:00");
});
