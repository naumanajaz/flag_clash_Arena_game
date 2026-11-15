/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Stripe {
  color: string;
  weight: number;
}

export interface CountryData {
  id: number;
  name: string;
  pattern: 'h' | 'v' | 'd' | 'c' | 's' | 'u' | 'b';
  stripes: Stripe[];
  colors: string[];
  emblemColor?: string;
  rawLine: string;
}

export const RAW_COUNTRY_DATA = `India|h|F93,fff,138|008
France|v|039,fff,E31
Italy|v|009246,fff,CE2B37
Ireland|v|169B62,fff,FF883E
Belgium|v|000,FDDA24,EF3340
Romania|v|002B7F,FCD116,CE1126
Nigeria|v|008751,fff,008751
Mali|v|14B53A,FCD116,CE1126
Germany|h|000,DD0000,FFCE00
Russia|h|fff,0039A6,D52B1E
Netherlands|h|AE1C28,fff,21468B
Hungary|h|CD2A3E,fff,436F4D
Bulgaria|h|fff,00966E,D62612
Poland|h|fff,DC143C
Ukraine|h|0057B7,FFD700
Austria|h|ED2939,fff,ED2939
Egypt|h|CE1126,fff,000|C09300
Estonia|h|0072CE,000,fff
Lithuania|h|FDB913,006A44,C1272D
Gabon|h|009E60,FCD116,3A75C4
Indonesia|h|E70011,fff
Singapore|h|EF3340,fff
Spain|h|AA151B,F1BF00:2,AA151B
Thailand|h|A51931,F4F5F8,2D2A4A:2,F4F5F8,A51931
Colombia|h|FCD116:2,003893,CE1126
Argentina|h|74ACDF,fff,74ACDF|F6B40E
Mexico|v|006847,fff,CE1126|8B5A2B
Peru|v|D91023,fff,D91023
Venezuela|h|FFCC00,00247D,CF142B
Ecuador|h|FFDD00:2,034EA2,ED1C24
Bolivia|h|D52B1E,F9E300,007934
Ghana|h|CE1126,FCD116,006B3F|000
Ethiopia|h|078930,FCD116,DA121A|0F47AF
Senegal|v|00853F,FDEF42,E31B23|00853F
Cameroon|v|007A5E,CE1126,FCD116
Portugal|v|006600:2,FF0000:3
Canada|v|D52B1E,fff:2,D52B1E|D52B1E
Serbia|h|C6363C,0C4076,fff
Croatia|h|FF0000,fff,171796
Slovakia|h|fff,0B4EA2,EE1C25
Latvia|h|9E3039:2,fff,9E3039:2
Armenia|h|D90012,0033A0,F2A800
Moldova|v|0046AE,FFD200,CC092F
Iraq|h|CE1126,fff,000
Japan|d|fff|BC002D
Bangladesh|d|006A4E|F42A41
Palau|d|4AADD6|FFDE00
Sweden|c|006AA7,FECC00
Norway|c|BA0C2F,fff|00205B
Denmark|c|C8102E,fff
Finland|c|fff,003580
Iceland|c|02529C,fff|DC1E35
Switzerland|s|DA291C,fff
USA|u
Brazil|b`;

function cleanColor(str: string): string {
  const trimmed = str.trim();
  if (trimmed.startsWith('#')) return trimmed;
  return `#${trimmed}`;
}

export function parseCountryData(raw: string): CountryData[] {
  const lines = raw.trim().split('\n');
  return lines.map((line, index) => {
    const parts = line.split('|');
    const name = parts[0].trim();
    const pattern = parts[1].trim() as CountryData['pattern'];
    const colorsPart = parts[2] ? parts[2].trim() : '';
    const emblemPart = parts[3] ? parts[3].trim() : undefined;

    const stripes: Stripe[] = [];
    const colors: string[] = [];

    if (colorsPart) {
      const colorTokens = colorsPart.split(',');
      for (const token of colorTokens) {
        const [c, w] = token.split(':');
        const color = cleanColor(c);
        const weight = w ? parseFloat(w) : 1;
        stripes.push({ color, weight });
        colors.push(color);
      }
    }

    const emblemColor = emblemPart ? cleanColor(emblemPart) : undefined;

    return {
      id: index,
      name,
      pattern,
      stripes,
      colors,
      emblemColor,
      rawLine: line.trim(),
    };
  });
}

export const COUNTRIES = parseCountryData(RAW_COUNTRY_DATA);

/**
 * Pre-renders a flag into an offscreen canvas badge of size S x S
 * following section 4 of the technical specification.
 */
export function createFlagBadge(country: CountryData, S: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    return {} as HTMLCanvasElement;
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.save();

  switch (country.pattern) {
    case 'h': {
      // Horizontal stripes top-to-bottom, height = weight / totalWeight * S (+1px overlap)
      const totalWeight = country.stripes.reduce((sum, s) => sum + s.weight, 0) || 1;
      let currY = 0;
      for (const stripe of country.stripes) {
        const stripeH = (stripe.weight / totalWeight) * S;
        ctx.fillStyle = stripe.color;
        ctx.fillRect(0, currY, S, stripeH + 1); // +1px overlap to avoid seams
        currY += stripeH;
      }
      // If emblem color exists (h/v): filled circle at centre, radius 0.14*S
      if (country.emblemColor) {
        ctx.fillStyle = country.emblemColor;
        ctx.beginPath();
        ctx.arc(0.5 * S, 0.5 * S, 0.14 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'v': {
      // Vertical stripes left-to-right, width = weight / totalWeight * S (+1px overlap)
      const totalWeight = country.stripes.reduce((sum, s) => sum + s.weight, 0) || 1;
      let currX = 0;
      for (const stripe of country.stripes) {
        const stripeW = (stripe.weight / totalWeight) * S;
        ctx.fillStyle = stripe.color;
        ctx.fillRect(currX, 0, stripeW + 1, S); // +1px overlap to avoid seams
        currX += stripeW;
      }
      // If emblem color exists (h/v): filled circle at centre, radius 0.14*S
      if (country.emblemColor) {
        ctx.fillStyle = country.emblemColor;
        ctx.beginPath();
        ctx.arc(0.5 * S, 0.5 * S, 0.14 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'd': {
      // Fill whole square with colour[0]; centre circle radius 0.3*S in emblem colour
      ctx.fillStyle = country.colors[0] || '#ffffff';
      ctx.fillRect(0, 0, S, S);

      if (country.emblemColor) {
        ctx.fillStyle = country.emblemColor;
        ctx.beginPath();
        ctx.arc(0.5 * S, 0.5 * S, 0.3 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'c': {
      // Nordic cross: background colour[0]; cross colour[1]: vertical bar x=0.3S, width 0.18S, full height;
      // horizontal bar y=0.41S, height 0.18S, full width.
      // If emblem colour: inner cross: vertical x=0.34S w=0.1S; horizontal y=0.45S h=0.1S.
      ctx.fillStyle = country.colors[0] || '#ffffff';
      ctx.fillRect(0, 0, S, S);

      const crossColor = country.colors[1] || '#ffffff';
      ctx.fillStyle = crossColor;
      ctx.fillRect(0.3 * S, 0, 0.18 * S, S);
      ctx.fillRect(0, 0.41 * S, S, 0.18 * S);

      if (country.emblemColor) {
        ctx.fillStyle = country.emblemColor;
        ctx.fillRect(0.34 * S, 0, 0.1 * S, S);
        ctx.fillRect(0, 0.45 * S, S, 0.1 * S);
      }
      break;
    }

    case 's': {
      // Switzerland: bg colour[0]; white plus: vertical x=0.4S y=0.2S w=0.2S h=0.6S;
      // horizontal x=0.2S y=0.4S w=0.6S h=0.2S.
      ctx.fillStyle = country.colors[0] || '#DA291C';
      ctx.fillRect(0, 0, S, S);

      const plusColor = country.colors[1] || '#ffffff';
      ctx.fillStyle = plusColor;
      ctx.fillRect(0.4 * S, 0.2 * S, 0.2 * S, 0.6 * S);
      ctx.fillRect(0.2 * S, 0.4 * S, 0.6 * S, 0.2 * S);
      break;
    }

    case 'u': {
      // USA: 7 horizontal stripes alternating #B22234 (even index) / white;
      // blue canton #3C3B6E at top-left, width 0.5S, height (4/7)S.
      const stripeH = S / 7;
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#B22234' : '#ffffff';
        ctx.fillRect(0, i * stripeH, S, stripeH + 0.5);
      }
      ctx.fillStyle = '#3C3B6E';
      ctx.fillRect(0, 0, 0.5 * S, (4 / 7) * S);
      break;
    }

    case 'b': {
      // Brazil: green #009C3B bg; yellow #FFDF00 diamond with points
      // (0.5S,0.12S),(0.9S,0.5S),(0.5S,0.88S),(0.1S,0.5S);
      // blue #002776 centre circle radius 0.2S.
      ctx.fillStyle = '#009C3B';
      ctx.fillRect(0, 0, S, S);

      ctx.fillStyle = '#FFDF00';
      ctx.beginPath();
      ctx.moveTo(0.5 * S, 0.12 * S);
      ctx.lineTo(0.9 * S, 0.5 * S);
      ctx.lineTo(0.5 * S, 0.88 * S);
      ctx.lineTo(0.1 * S, 0.5 * S);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#002776';
      ctx.beginPath();
      ctx.arc(0.5 * S, 0.5 * S, 0.2 * S, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  // Clip to circle (globalCompositeOperation="destination-in", circle radius 0.5S)
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(0.5 * S, 0.5 * S, 0.5 * S, 0, Math.PI * 2);
  ctx.fill();

  // White ring: lineWidth max(2, 0.05*S), radius 0.48S, centred
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.arc(0.5 * S, 0.5 * S, 0.48 * S, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, 0.05 * S);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.restore();
  return canvas;
}
