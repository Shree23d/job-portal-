/**
 * Human-like Autonomous Browser Helper
 * Provides realistic visual mouse movement, visible cursor indicator, natural scrolling,
 * and deliberate human-like typing cadence.
 */

class HumanBrowser {
  /**
   * Injects a visible glowing cursor and floating status badge into the page.
   */
  static async injectVisualCursor(page) {
    try {
      await page.evaluate(() => {
        if (document.getElementById('autonomous-agent-cursor')) return;

        // Container
        const cursor = document.createElement('div');
        cursor.id = 'autonomous-agent-cursor';
        cursor.innerHTML = `
          <div class="cursor-pointer"></div>
          <div class="cursor-ripple"></div>
          <div class="cursor-status-pill">🤖 AI Agent Initialized</div>
        `;

        // Styling
        const style = document.createElement('style');
        style.id = 'autonomous-agent-cursor-styles';
        style.textContent = `
          #autonomous-agent-cursor {
            position: fixed;
            top: 100px;
            left: 100px;
            width: 24px;
            height: 24px;
            pointer-events: none;
            z-index: 2147483647;
            transform: translate(-4px, -4px);
            transition: left 0.22s cubic-bezier(0.25, 1, 0.5, 1), top 0.22s cubic-bezier(0.25, 1, 0.5, 1);
            display: flex;
            align-items: center;
          }
          #autonomous-agent-cursor .cursor-pointer {
            width: 18px;
            height: 18px;
            background: radial-gradient(circle, #38bdf8 0%, #0284c7 60%, rgba(2, 132, 199, 0.4) 100%);
            border: 2px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 0 14px rgba(56, 189, 248, 0.8), 0 2px 8px rgba(0, 0, 0, 0.4);
            flex-shrink: 0;
          }
          #autonomous-agent-cursor .cursor-ripple {
            position: absolute;
            top: -6px;
            left: -6px;
            width: 30px;
            height: 30px;
            border: 2px solid #38bdf8;
            border-radius: 50%;
            opacity: 0;
            transform: scale(0.6);
            pointer-events: none;
          }
          #autonomous-agent-cursor.clicked .cursor-ripple {
            animation: cursorRippleAnim 0.45s ease-out forwards;
          }
          @keyframes cursorRippleAnim {
            0% { transform: scale(0.6); opacity: 1; border-color: #38bdf8; }
            100% { transform: scale(2.2); opacity: 0; border-color: #a855f7; }
          }
          #autonomous-agent-cursor .cursor-status-pill {
            margin-left: 12px;
            background: rgba(15, 23, 42, 0.88);
            color: #f8fafc;
            border: 1px solid rgba(56, 189, 248, 0.4);
            backdrop-filter: blur(8px);
            padding: 4px 10px;
            border-radius: 999px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.2px;
            white-space: nowrap;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
            transition: all 0.2s ease;
          }
        `;

        document.head.appendChild(style);
        document.body.appendChild(cursor);

        // Store last cursor coordinates
        window._autonomousCursorX = 100;
        window._autonomousCursorY = 100;
      }).catch(() => {});
    } catch (e) {
      // Ignored if frame/context is navigating
    }
  }

  /**
   * Updates the floating status text next to the visible cursor.
   */
  static async updateStatus(page, text) {
    try {
      await page.evaluate((msg) => {
        const pill = document.querySelector('#autonomous-agent-cursor .cursor-status-pill');
        if (pill) pill.textContent = msg;
      }, text).catch(() => {});
    } catch (e) {}
  }

  /**
   * Visually moves the cursor to (x, y) coordinates and updates the Playwright mouse.
   */
  static async moveTo(page, x, y) {
    try {
      await page.evaluate(({ tx, ty }) => {
        const cursor = document.getElementById('autonomous-agent-cursor');
        if (cursor) {
          cursor.style.left = `${tx}px`;
          cursor.style.top = `${ty}px`;
        }
        window._autonomousCursorX = tx;
        window._autonomousCursorY = ty;
      }, { tx: Math.round(x), ty: Math.round(y) }).catch(() => {});

      await page.mouse.move(x, y, { steps: 5 }).catch(() => {});
      await page.waitForTimeout(60);
    } catch (e) {}
  }

  /**
   * Natural human-like scroll down with smooth increments and reading pauses.
   */
  static async smoothScroll(page, totalDistance = 500, statusText = '📜 Scrolling & Reading Page Details...') {
    if (statusText) await this.updateStatus(page, statusText);
    const step = 120;
    let scrolled = 0;
    while (scrolled < totalDistance) {
      const delta = Math.min(step, totalDistance - scrolled);
      await page.evaluate((d) => {
        window.scrollBy({ top: d, left: 0, behavior: 'smooth' });
      }, delta).catch(() => {});
      scrolled += delta;
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(400); // pause to "read"
  }

  /**
   * Visually moves to element, scrolls it into view, ripples the cursor, and clicks.
   */
  static async humanClick(page, elementOrLocator, statusText = null) {
    if (statusText) await this.updateStatus(page, statusText);

    try {
      // Scroll into view if needed
      await elementOrLocator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});

      const box = await elementOrLocator.boundingBox().catch(() => null);
      if (box) {
        const targetX = box.x + box.width / 2;
        const targetY = box.y + box.height / 2;
        await this.moveTo(page, targetX, targetY);

        // Trigger visual click ripple
        await page.evaluate(() => {
          const cursor = document.getElementById('autonomous-agent-cursor');
          if (cursor) {
            cursor.classList.remove('clicked');
            void cursor.offsetWidth; // retrigger reflow
            cursor.classList.add('clicked');
          }
        }).catch(() => {});

        await page.waitForTimeout(120);
        await elementOrLocator.click({ timeout: 4000 });
        await page.waitForTimeout(300);
      } else {
        await elementOrLocator.click({ timeout: 4000 });
      }
    } catch (e) {
      // Fallback standard click
      await elementOrLocator.click({ force: true }).catch(() => {});
    }
  }

  /**
   * Visually moves to input field, focuses it, clears if needed, and types characters with human delays.
   */
  static async humanType(page, elementOrLocator, text, statusText = null) {
    if (statusText) await this.updateStatus(page, statusText);

    try {
      await this.humanClick(page, elementOrLocator);
      await elementOrLocator.fill(''); // clear
      await page.waitForTimeout(100);

      // Natural typing with slight random variation
      for (const char of String(text)) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 25) + 20 });
      }
      await page.waitForTimeout(150);
    } catch (e) {
      // Fallback direct fill
      await elementOrLocator.fill(String(text)).catch(() => {});
    }
  }

  /**
   * Highlights an element with an animated glowing border (useful for Dry-Run final step).
   */
  static async highlightElement(page, elementOrLocator, color = '#22c55e') {
    try {
      await elementOrLocator.evaluate((el, c) => {
        el.style.outline = `3px solid ${c}`;
        el.style.boxShadow = `0 0 20px ${c}, inset 0 0 10px ${c}`;
        el.style.transition = 'all 0.3s ease';
      }, color).catch(() => {});
    } catch (e) {}
  }
}

module.exports = HumanBrowser;
