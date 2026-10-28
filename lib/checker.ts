/* Structural checks for untrusted JSON (template files, localStorage). Each
   failure is collected with where it happened, in French, for the user. */

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isStr = (v: unknown): v is string => typeof v === "string";
export const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

export class Checker {
  errors: string[] = [];
  fail(at: string, msg: string) {
    this.errors.push(`${at} : ${msg}`);
  }
  str(o: Obj, k: string, at: string): string {
    if (isStr(o[k])) return o[k];
    this.fail(at, `« ${k} » texte attendu.`);
    return "";
  }
  num(o: Obj, k: string, at: string): number {
    if (isNum(o[k])) return o[k];
    this.fail(at, `« ${k} » nombre attendu.`);
    return 0;
  }
  /** A whole number, at least `min`: money in F CFA, counts, days. */
  int(o: Obj, k: string, at: string, min = 0): number {
    const v = o[k];
    if (isNum(v) && Number.isInteger(v) && v >= min) return v;
    this.fail(at, `« ${k} » nombre entier${min > 0 ? ` d'au moins ${min}` : min === 0 ? " positif" : ""} attendu.`);
    return Math.max(min, 0);
  }
  bool(o: Obj, k: string, at: string): boolean {
    if (typeof o[k] === "boolean") return o[k];
    this.fail(at, `« ${k} » vrai ou faux attendu.`);
    return false;
  }
  strList(o: Obj, k: string, at: string): string[] {
    if (isStrList(o[k])) return o[k];
    this.fail(at, `« ${k} » liste de textes attendue.`);
    return [];
  }
  obj(o: Obj, k: string, at: string): Obj {
    if (isObj(o[k])) return o[k];
    this.fail(at, `« ${k} » objet attendu.`);
    return {};
  }
  list<T>(v: unknown, at: string, each: (x: Obj, at: string) => T): T[] {
    if (!Array.isArray(v)) {
      this.fail(at, "liste attendue.");
      return [];
    }
    return v.flatMap((x, i) => {
      if (isObj(x)) return [each(x, `${at} ${i + 1}`)];
      this.fail(`${at} ${i + 1}`, "objet attendu.");
      return [];
    });
  }
  oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[], at: string): T {
    const v = o[k];
    const hit = allowed.find((a) => a === v);
    if (hit) return hit;
    this.fail(at, `« ${k} » doit valoir ${allowed.join(" ou ")}.`);
    return allowed[0];
  }
  /** Record of whole numbers keyed by id, e.g. a quantity per bottle format. */
  counts(o: Obj, k: string, at: string): Record<string, number> {
    const v = o[k];
    if (!isObj(v)) {
      this.fail(at, `« ${k} » objet attendu.`);
      return {};
    }
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(v)) {
      if (isNum(n) && Number.isInteger(n) && n >= 0) out[id] = n;
      else this.fail(at, `« ${k}.${id} » nombre entier positif attendu.`);
    }
    return out;
  }
}
