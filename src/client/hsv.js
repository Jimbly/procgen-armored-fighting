// From libGlov, MIT Licensed, (c) 2005-2017 Jimb Esser, various authors

const { floor } = Math;

// out [0,1](3)
// hue [0,360)
// s [0,1]
// v [0,1]
export function hsvToRGB(out, h, s, v) {
  if (s === 0) {
    // achromatic (grey)
    out[0] = out[1] = out[2] = v;
    return out;
  }
  h /= 60;      // sector 0 to 5
  if (h>=6) {
    h-=6;
  }
  let i = floor(h);
  let f = h - i;      // factorial part of h
  let p = v * (1 - s);
  let q = v * (1 - s * f);
  let t = v * (1 - s * (1 - f));
  switch (i) {
    case 0:
      out[0] = v;
      out[1] = t;
      out[2] = p;
      break;
    case 1:
      out[0] = q;
      out[1] = v;
      out[2] = p;
      break;
    case 2:
      out[0] = p;
      out[1] = v;
      out[2] = t;
      break;
    case 3:
      out[0] = p;
      out[1] = q;
      out[2] = v;
      break;
    case 4:
      out[0] = t;
      out[1] = p;
      out[2] = v;
      break;
    default:    // case 5:
      out[0] = v;
      out[1] = p;
      out[2] = q;
      break;
  }
  return out;
}
