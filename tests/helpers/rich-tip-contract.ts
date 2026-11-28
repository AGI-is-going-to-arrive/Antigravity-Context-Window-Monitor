import { expect } from 'vitest';

// ─── Shared Rich-Tip & Popover Contract Assertions ───────────────────────────

export function extractAttributeValues(html: string, attrName: string): string[] {
    const regex = new RegExp(`${attrName}="([^"]*)"`, 'g');
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        values.push(match[1]);
    }
    return values;
}

export interface RichTipContractOptions {
    /** Require at least one data-popover-key attribute (default: true). */
    requirePopoverKeys?: boolean;
    /** Check banned Chinese terminology (default: true). */
    checkBannedTerms?: boolean;
    /** Check glued bilingual spans inside inline-flex tags (default: true). */
    checkGluedBilingualChips?: boolean;
}

export function assertFrozenRichTipContract(
    html: string,
    contextLabel: string,
    options: RichTipContractOptions = {},
): void {
    const {
        requirePopoverKeys = true,
        checkBannedTerms = true,
        checkGluedBilingualChips = true,
    } = options;

    // 1. Zero legacy CSS data-tooltip attributes
    expect(html, `${contextLabel}: must not emit legacy data-tooltip`).not.toMatch(/\bdata-tooltip="/);

    // 2. Zero native title="..." attributes on elements (no duplicate IDE tooltip)
    expect(html, `${contextLabel}: must not emit native title="..."`).not.toMatch(/(?<![a-z-])title="/);

    // 3. Every data-popover-key must be non-empty and globally unique
    const keys = extractAttributeValues(html, 'data-popover-key');
    if (requirePopoverKeys) {
        expect(keys.length, `${contextLabel}: expected at least one data-popover-key`).toBeGreaterThan(0);
    }
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const key of keys) {
        expect(key.trim().length, `${contextLabel}: empty data-popover-key`).toBeGreaterThan(0);
        const count = (seen.get(key) || 0) + 1;
        seen.set(key, count);
        if (count === 2) {
            duplicates.push(key);
        }
    }
    expect(duplicates, `${contextLabel}: duplicate data-popover-key values`).toEqual([]);

    // 4. Every data-tip-html-id must match an existing <template id="...">
    const htmlIds = extractAttributeValues(html, 'data-tip-html-id');
    for (const id of htmlIds) {
        expect(html, `${contextLabel}: missing <template id="${id}">`).toContain(`<template id="${id}">`);
    }

    // 5. Zero banned terminology
    if (checkBannedTerms) {
        expect(html, `${contextLabel}: banned term 令牌`).not.toContain('令牌');
        expect(html, `${contextLabel}: banned term 编排器模型`).not.toContain('编排器模型');
        expect(html, `${contextLabel}: banned term 执行器模型`).not.toContain('执行器模型');
    }

    // 6. Inline-flex tags never glue bilingual spans directly next to bare numbers
    if (checkGluedBilingualChips) {
        expect(
            html,
            `${contextLabel}: glued bilingual span inside inline-flex chip`,
        ).not.toMatch(/class="(?:act-tl-gm-tag|seg-chip|telemetry-pill|telemetry-warmth-badge)[^"]*">[^<]*<span class="bi-en">/);
    }
}

export function assertBalancedCssBraces(css: string, label: string, minBlocks = 10): void {
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    expect(opens, `${label}: balanced CSS braces`).toBe(closes);
    expect(opens, `${label}: non-empty CSS`).toBeGreaterThan(minBlocks);
}

// ─── Lightweight DOM Harness for Client-Side VM Behavioral Tests ─────────────

export class MiniClassList {
    private set = new Set<string>();
    constructor(private owner: MiniElement) {}
    syncFromClassName(cls: string): void {
        this.set = new Set(cls.split(/\s+/).filter(Boolean));
    }
    private flush(): void {
        this.owner._className = [...this.set].join(' ');
    }
    add(...names: string[]): void {
        for (const n of names) { if (n) { this.set.add(n); } }
        this.flush();
    }
    remove(...names: string[]): void {
        for (const n of names) { this.set.delete(n); }
        this.flush();
    }
    toggle(name: string, force?: boolean): boolean {
        const next = force !== undefined ? Boolean(force) : !this.set.has(name);
        if (next) { this.set.add(name); } else { this.set.delete(name); }
        this.flush();
        return next;
    }
    contains(name: string): boolean {
        return this.set.has(name);
    }
}

export class MiniElement {
    tagName: string;
    id = '';
    _className = '';
    classList: MiniClassList;
    attrs = new Map<string, string>();
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: MiniElement[] = [];
    parentElement: MiniElement | null = null;
    hidden = false;
    disabled = false;
    textContent = '';
    _innerHTML = '';
    scrollTop = 0;
    offsetWidth = 220;
    offsetHeight = 76;
    rect = { left: 100, right: 160, top: 200, bottom: 224, width: 60, height: 24 };
    listeners = new Map<string, Array<(e: unknown) => void>>();
    content?: { cloneNode: (deep?: boolean) => MiniElement };

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
        this.classList = new MiniClassList(this);
    }

    get className(): string { return this._className; }
    set className(v: string) {
        this._className = v;
        this.classList.syncFromClassName(v);
    }

    get innerHTML(): string { return this._innerHTML; }
    set innerHTML(v: string) {
        this._innerHTML = v;
        this.textContent = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    setAttribute(k: string, v: string): void {
        this.attrs.set(k, String(v));
        if (k === 'id') { this.id = String(v); }
        if (k === 'class') { this.className = String(v); }
        if (k.startsWith('data-')) {
            const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[camel] = String(v);
        }
    }

    getAttribute(k: string): string | null {
        if (k === 'id' && this.id) { return this.id; }
        if (k === 'class' && this._className) { return this._className; }
        return this.attrs.has(k) ? this.attrs.get(k)! : null;
    }

    hasAttribute(k: string): boolean {
        return this.attrs.has(k) || (k === 'id' && !!this.id);
    }

    removeAttribute(k: string): void {
        this.attrs.delete(k);
    }

    appendChild(child: MiniElement): MiniElement {
        child.parentElement = this;
        this.children.push(child);
        if (child._innerHTML) {
            this._innerHTML += child._innerHTML;
        }
        if (child.textContent) {
            this.textContent = (this.textContent ? `${this.textContent} ` : '') + child.textContent;
        }
        return child;
    }

    remove(): void {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(c => c !== this);
            this.parentElement = null;
        }
    }

    contains(node: unknown): boolean {
        let cur: MiniElement | null = node as MiniElement | null;
        while (cur) {
            if (cur === this) { return true; }
            cur = cur.parentElement;
        }
        return false;
    }

    addEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.listeners.get(type) || [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.listeners.get(type);
        if (!list) { return; }
        this.listeners.set(type, list.filter(item => item !== fn));
    }

    getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
        return { ...this.rect };
    }

    matches(selector: string): boolean {
        const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            if (p.startsWith('#') && this.id === p.slice(1)) { return true; }
            if (p.startsWith('.') && this.classList.contains(p.slice(1))) { return true; }
            const attrMatch = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(p);
            if (attrMatch) {
                const [, attr, expected] = attrMatch;
                if (expected !== undefined) {
                    if (this.getAttribute(attr) === expected) { return true; }
                } else if (this.hasAttribute(attr)) {
                    return true;
                }
            }
            if (this.tagName === p.toUpperCase()) { return true; }
        }
        return false;
    }

    closest(selector: string): MiniElement | null {
        let cur: MiniElement | null = this;
        while (cur) {
            if (cur.matches(selector)) { return cur; }
            cur = cur.parentElement;
        }
        return null;
    }

    querySelector(selector: string): MiniElement | null {
        for (const child of this.children) {
            if (child.matches(selector)) { return child; }
            const nested = child.querySelector(selector);
            if (nested) { return nested; }
        }
        return null;
    }

    querySelectorAll(selector: string): MiniElement[] {
        const found: MiniElement[] = [];
        for (const child of this.children) {
            if (child.matches(selector)) { found.push(child); }
            found.push(...child.querySelectorAll(selector));
        }
        return found;
    }

    focus(): void { /* noop in headless VM harness */ }
    blur(): void { /* noop in headless VM harness */ }
    click(): void {
        for (const fn of this.listeners.get('click') || []) {
            fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
        }
    }
}
