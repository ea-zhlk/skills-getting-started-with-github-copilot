import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    const availability = value.match(
      /<span class="availability-count">([^<]*)<\/span>/,
    );
    if (availability) {
      this.availabilityCount = new Element("span");
      this.availabilityCount.textContent = availability[1];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get options() {
    return this.tagName === "select" ? this.children : undefined;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  insertBefore(child, reference) {
    child.parent = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
  }

  remove(index) {
    if (Number.isInteger(index)) {
      this.children.splice(index, 1);
      return;
    }

    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
    }
  }

  querySelector(selector) {
    if (selector === ".availability-count") {
      this.availabilityCount ??= new Element("span");
      return this.availabilityCount;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  dispatch(type, event = {}) {
    return this.listeners[type](event);
  }

  reset() {}
}

test("unregister refresh wins over an in-flight signup refresh", async () => {
  const requests = [];
  const fetch = (url, options = {}) =>
    new Promise((resolve) => {
      requests.push({
        url,
        options,
        resolve: (body, ok = true) => resolve({ ok, json: async () => body }),
      });
    });
  const elements = {
    "activities-list": new Element(),
    activity: new Element("select"),
    "signup-form": new Element("form"),
    message: new Element(),
    email: new Element("input"),
  };
  elements.activity.appendChild(new Element("option"));
  elements.activity.value = "Chess Club";
  elements.email.value = "student@example.com";
  const document = {
    addEventListener: (type, listener) => {
      document.listeners[type] = listener;
    },
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => elements[id],
    listeners: {},
  };
  const source = readFileSync(
    fileURLToPath(new URL("../src/static/app.js", import.meta.url)),
    "utf8",
  );
  runInNewContext(source, {
    console,
    document,
    fetch,
    setTimeout: () => {},
  });

  const activityWithParticipant = {
    "Chess Club": {
      description: "Play chess",
      schedule: "Fridays",
      max_participants: 2,
      participants: ["student@example.com"],
    },
  };
  const activityWithoutParticipant = {
    "Chess Club": {
      ...activityWithParticipant["Chess Club"],
      participants: [],
    },
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  document.listeners.DOMContentLoaded();
  requests[0].resolve(activityWithParticipant);
  await flush();

  const removeButton =
    elements["activities-list"].children[0].children[0].children[1].children[0]
      .children[1];
  const unregisterPromise = removeButton.dispatch("click");
  const signupPromise = elements["signup-form"].dispatch("submit", {
    preventDefault() {},
  });
  requests[2].resolve({ message: "Signed up" });
  await flush();

  requests[1].resolve({ message: "Unregistered" });
  await flush();
  requests[4].resolve(activityWithoutParticipant);
  await unregisterPromise;
  requests[3].resolve(activityWithParticipant);
  await signupPromise;

  const currentCard = elements["activities-list"].children[0];
  const participantsSection = currentCard.children[0];
  assert.equal(participantsSection.children[0].textContent, "Participants (0)");
  assert.equal(
    currentCard.querySelector(".availability-count").textContent,
    "2 spots left",
  );
  assert.equal(participantsSection.children[1].textContent, "No participants yet");
});
