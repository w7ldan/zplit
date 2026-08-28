export type PlainDto = null | string | number | boolean | PlainDto[] | { [key: string]: PlainDto };

export function assertPlainDto(value: unknown, path = "value"): asserts value is PlainDto {
  const ancestors = new WeakSet<object>();

  function visitArray(current: unknown[], currentPath: string) {
    for (let index = 0; index < current.length; index += 1) {
      if (!Object.hasOwn(current, index)) throw new TypeError(`${currentPath}[${index}] is missing`);
      visit(current[index], `${currentPath}[${index}]`);
    }
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) throw new TypeError(`${currentPath} has unsupported property ${String(key)}`);
    }
  }

  function visitObject(current: object, currentPath: string) {
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${currentPath} must be a plain object`);
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") throw new TypeError(`${currentPath} has a symbol property`);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) throw new TypeError(`${currentPath}.${key} must be data-only`);
      visit(descriptor.value, `${currentPath}.${key}`);
    }
  }

  function visit(current: unknown, currentPath: string): void {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (Number.isFinite(current)) return;
      throw new TypeError(`${currentPath} must contain a finite number`);
    }
    if (typeof current !== "object") throw new TypeError(`${currentPath} contains unsupported ${typeof current}`);
    if (ancestors.has(current)) throw new TypeError(`${currentPath} contains a circular reference`);
    ancestors.add(current);
    if (Array.isArray(current)) visitArray(current, currentPath);
    else visitObject(current, currentPath);
    ancestors.delete(current);
  }

  visit(value, path);
}
