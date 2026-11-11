"""Fail-closed official airline booking adapters.

A verified fare requires the *visible* result to identify the exact flight and a
single comparable price. Never treat a missing selector, 403, challenge or time-out
as an unavailable flight. This module intentionally does not bypass anti-bot tools.
"""
import json
import re
import time
from datetime import date
from pathlib import Path

from .extract import AIRPORTS, find_prices, parse_offer_card


class SiteChanged(RuntimeError):
    """The booking page could not be safely navigated or interpreted."""


class AccessBlocked(RuntimeError):
    """Provider has displayed a browser challenge or access restriction."""


class NoFareAvailable(RuntimeError):
    """The booking site explicitly stated that no flights were found."""


BLOCK_TERMS = (
    'verify you are human', 'robot verification', 'access denied',
    'too many requests', 'подтвердите, что вы не робот', 'проверка безопасности',
    'captcha challenge', 'cloudflare ray id',
)
NO_FARES = (
    'нет рейсов', 'рейсы не найдены', 'билетов нет', 'no flights found',
    'no results found', 'no fares available', 'no available flights',
    'no flights available',
)


def first_visible(page, candidates, timeout=3000):
    """Poll *all* alternatives for the total timeout.

    Playwright locator.is_visible(timeout=...) does not wait for visibility;
    the old implementation therefore rejected asynchronously rendered forms.
    """
    deadline = time.monotonic() + max(0, timeout) / 1000
    while True:
        for selector in candidates:
            try:
                candidate = page.locator(selector).first
                if candidate.is_visible():
                    return candidate
            except Exception:
                continue
        if time.monotonic() >= deadline:
            break
        time.sleep(min(0.12, max(0, deadline - time.monotonic())))
    raise SiteChanged('CONTROL_NOT_VISIBLE selectors=' + ','.join(candidates[:5]))


def assert_not_blocked(page):
    try:
        body = page.locator('body').inner_text(timeout=7000).casefold()
    except Exception as exc:
        raise SiteChanged('PAGE_BODY_NOT_READABLE') from exc
    if any(value in body for value in BLOCK_TERMS):
        raise AccessBlocked('PROVIDER_BROWSER_CHALLENGE: official booking blocked; no bypass')


def _matching_airport_option(control, iata):
    """Return select option index only for a verifiable IATA/city match."""
    options = control.locator('option')
    for index in range(options.count()):
        opt = options.nth(index)
        name = ((opt.inner_text() or '') + ' ' + (opt.get_attribute('value') or '')).casefold()
        if re.search(r'(?<![a-z])' + re.escape(iata.casefold()) + r'(?![a-z])', name) or any(
            city.casefold() in name for city in AIRPORTS.get(iata, ())
        ):
            return index
    return None


def _airport_select_fallback(page, iata, role):
    """HY's page uses unlabeled selects; only consider selects with airport options.

    Never select a currency/language field or reuse the origin select as destination.
    """
    try:
        loc = page.locator('select:visible')
        matches = []
        for i in range(min(loc.count(), 12)):
            candidate = loc.nth(i)
            if _matching_airport_option(candidate, iata) is not None:
                matches.append(candidate)
        slot = 0 if role == 'origin' else 1
        if len(matches) > slot:
            return matches[slot]
    except Exception:
        pass
    raise SiteChanged(f'{role.upper()}_CONTROL_NOT_FOUND airport={iata}')


def select_airport(page, candidates, iata, role='origin'):
    try:
        control = first_visible(page, candidates, timeout=5500)
    except SiteChanged:
        control = _airport_select_fallback(page, iata, role)
    tag = (control.evaluate('(el) => el.tagName') or '').lower()
    if tag == 'select':
        index = _matching_airport_option(control, iata)
        if index is None:
            raise SiteChanged(f'{role.upper()}_OPTION_NOT_FOUND airport={iata}')
        control.select_option(index=index)
        return
    control.click()
    if tag == 'button':
        field = first_visible(page, [
            '[role="dialog"] input:visible', '[role="combobox"] input:visible',
            'input:focus', '[role="dialog"] input', 'input[placeholder*="Origin"]',
            'input[placeholder*="Destination"]', 'input[placeholder*="From"]',
            'input[placeholder*="To"]', 'input[placeholder*="Откуда"]',
            'input[placeholder*="Куда"]',
        ], timeout=4500)
    else:
        field = control
    for query in [iata, *AIRPORTS.get(iata, ())[:1]]:
        try:
            field.fill(query)
        except Exception as exc:
            raise SiteChanged(f'{role.upper()}_INPUT_NOT_EDITABLE airport={iata}') from exc
        labels = [iata, *AIRPORTS.get(iata, ())[:1]]
        selectors = ([f'[role="option"]:has-text("{v}")' for v in labels]
                     + [f'li:has-text("{v}")' for v in labels]
                     + [f'[class*="Option"]:has-text("{v}")' for v in labels])
        try:
            first_visible(page, selectors, timeout=1500).click()
            return
        except SiteChanged:
            continue
    raise SiteChanged(f'{role.upper()}_OPTION_NOT_VISIBLE airport={iata}')


def select_departure_date(page, candidates, target):
    field = first_visible(page, candidates, timeout=5000)
    fmt = target.isoformat()
    typ = (field.get_attribute('type') or '').lower()
    if typ == 'date':
        field.fill(fmt)
        field.press('Tab')
        if field.input_value() != fmt:
            raise SiteChanged(f'DATE_NOT_ACCEPTED target={fmt}')
        return
    if field.get_attribute('readonly') is None and typ != 'button':
        for text in (fmt, target.strftime('%d.%m.%Y')):
            try:
                field.fill(text)
                field.press('Tab')
                if text in field.input_value():
                    return
            except Exception:
                continue
    field.click()
    # Only click dates whose accessibility metadata contains the full date.
    # Selecting the day number alone can silently select the wrong month.
    month = target.strftime('%B')
    year = target.year
    day = target.day
    ru_months = ['января','февраля','марта','апреля','мая','июня',
                 'июля','августа','сентября','октября','ноября','декабря']
    day_long = f'{month} {day}, {year}'
    day_long2 = f'{day} {month} {year}'
    ru_long = f'{day} {ru_months[target.month-1]} {year}'
    options = [
        f'[data-date="{fmt}"]', f'[data-day="{fmt}"]',
        f'[aria-label*="{fmt}"]', f'[title*="{fmt}"]',
        f'[aria-label*="{day_long}"]', f'[aria-label*="{day_long2}"]',
        f'[aria-label*="{ru_long}"]', f'[title*="{day_long}"]',
    ]
    try:
        first_visible(page, options, timeout=3500).click()
    except SiteChanged as exc:
        raise SiteChanged(f'DATE_EXACT_DAY_NOT_FOUND target={fmt}; booking calendar needs calibration') from exc


def _read_results(page, settings, timeout_ms=19000):
    """Allow provider JS to populate results instead of a fixed 3-second delay."""
    selectors = settings['selectors']['flight_cards']
    until = time.monotonic() + timeout_ms / 1000
    last_text = ''
    while True:
        assert_not_blocked(page)
        cards = []
        for selector in selectors:
            try:
                loc = page.locator(selector)
                for i in range(min(35, loc.count())):
                    candidate = loc.nth(i)
                    if candidate.is_visible():
                        body = candidate.inner_text(timeout=2000).strip()
                        if body:
                            cards.append(body)
                if cards:
                    return cards
            except Exception:
                continue
        try:
            last_text = page.locator('body').inner_text(timeout=2500).casefold()
        except Exception:
            pass
        if any(phrase in last_text for phrase in NO_FARES):
            raise NoFareAvailable('OFFICIAL_NO_FLIGHTS: booking results explicitly empty')
        if time.monotonic() >= until:
            break
        time.sleep(0.35)
    raise SiteChanged(f'RESULT_CARDS_NOT_VISIBLE after={timeout_ms//1000}s; url={page.url[:150]}')


def search_one(page, settings, task, diagnostics):
    p = settings['selectors']
    Path(diagnostics).mkdir(parents=True, exist_ok=True)
    stage = 'load_booking'
    try:
        response = page.goto(settings['booking_url'], wait_until='domcontentloaded', timeout=50000)
        if response and response.status in (401, 403, 429):
            raise AccessBlocked(f'PROVIDER_HTTP_{response.status}')
        if response and response.status >= 500:
            raise SiteChanged(f'PROVIDER_HTTP_{response.status}')
        assert_not_blocked(page)
        stage = 'origin_airport'
        select_airport(page, p['origin_input'], task['origin'], 'origin')
        stage = 'destination_airport'
        select_airport(page, p['destination_input'], task['destination'], 'destination')
        stage = 'departure_date'
        select_departure_date(page, p['departure_input'], date.fromisoformat(task['departure_date']))
        stage = 'submit_search'
        first_visible(page, p['search_button'], timeout=5500).click()
        stage = 'wait_results'
        text_cards = _read_results(page, settings)
        stage = 'exact_fare_matching'
        records = []
        for body in text_cards:
            offer = parse_offer_card(
                body, airline_code=settings['airline_code'], provider=settings['provider'],
                origin=task['origin'], destination=task['destination'],
                date=task['departure_date'], adults=1, source_url=page.url,
            )
            if offer and offer['flight_number'] == task['flight_number']:
                records.append(offer)
        if not records:
            # The page can list related flights, but none is a proven fare for
            # THIS exact physical flight. Never publish a nearby flight's price.
            priced_cards = sum(bool(find_prices(body)) for body in text_cards)
            raise SiteChanged(
                f'EXACT_FARE_NOT_PROVEN wanted={task["flight_number"]} '
                f'cards={len(text_cards)} priced_cards={priced_cards}'
            )
        return records
    except (SiteChanged, AccessBlocked, NoFareAvailable) as exc:
        raise type(exc)(f'{stage}: {exc}') from exc
    except Exception as exc:
        raise SiteChanged(f'{stage}: {type(exc).__name__}: {str(exc)[:140]}') from exc


def save_diagnostic(page, folder, task, error):
    """Produce an inspectable Action artifact without cookies, tokens or HTML JS."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    key = re.sub(r'[^A-Za-z0-9_-]', '_',
                 f'{task["flight_number"]}-{task["origin"]}-{task["destination"]}-{task["departure_date"]}')
    try:
        page.screenshot(path=str(folder / f'{key}.png'), full_page=True, timeout=8000)
    except Exception:
        pass
    details = {'flight_number': task['flight_number'], 'origin': task['origin'],
               'destination': task['destination'], 'departure_date': task['departure_date'],
               'error': str(error)[:400]}
    try:
        details['page_url'] = page.url[:300]
        details['title'] = page.title()[:150]
        details['visible_text_excerpt'] = page.locator('body').inner_text(timeout=2500)[:1400]
    except Exception:
        pass
    (folder / f'{key}.json').write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding='utf-8')
