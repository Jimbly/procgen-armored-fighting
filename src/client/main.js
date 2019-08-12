/*eslint global-require:off*/
/*global Z: false */

const assert = require('assert');
const camera2d = require('./glov/camera2d.js');
const geom = require('./glov/geom.js');
const effects = require('./glov/effects.js');
const engine = require('./glov/engine.js');
const fs = require('fs');
const { hsvToRGB } = require('./hsv.js');
const input = require('./glov/input.js');
const glov_local_storage = require('./glov/local_storage.js');
const { abs, floor, max, min, PI, sin } = Math;
//const glov_particles = require('./glov/particles.js');
const sprites = require('./glov/sprites.js');
// const glov_sprite_animation = require('./glov/sprite_animation.js');
const ui = require('./glov/ui.js');
// const particle_data = require('./particle_data.js');
const random_seed = require('random-seed');
const { ridx } = require('../common/util.js');
const shaders = require('./glov/shaders.js');

const { vec2, vec3, vec4, unit_vec } = require('./glov/vmath.js');
const { mat2d, identity_mat2d, m2translate, m2mul, m2rot, m2scale, m2v2transform } = require('./glov/mat2d.js');

glov_local_storage.storage_prefix = 'glovjs-procgen';
window.Z = window.Z || {};
Z.BACKGROUND = 0;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.POST = 3100;
Z.UI = 3000;
Z.UI_TEST = 200;

const DRAW_NODES = false;

// let app = exports;
// Virtual viewport for our game logic
export const game_width = 1000;
export const game_height = 1000;

const color_black = vec4(0.3,0.3,0.3, 1);
const color_large_laser = vec4(1, 0, 0.5, 1);
const color_med_laser = vec4(0, 1, 0.5, 1);
const color_small_laser = vec4(0.8, 1.0, 0.5, 1);
const color_lrm = vec4(1, 0.5, 0, 1);

export function main() {
  if (!engine.startup({
    game_width,
    game_height,
    pixely: 'off',
    viewport_postprocess: false,
    do_borders: false,
    ui_sprites: {
      button: ['ui.local/button', [34, 60, 34], [63]],
      button_disabled: ['ui.local/button_disabled', [34, 60, 34], [63]],
      button_down: ['ui.local/button_down', [34, 60, 34], [63]],
      panel: ['ui.local/panel', [11, 26, 11], [11, 20, 11]],
    },
  })) {
    return;
  }

  // const font = engine.font;

  // Perfect sizes for pixely modes
  //ui.scaleSizes(13 / 32);
  //ui.setFontHeight(8);

  let vshader;
  let fshader;
  function initGraphics() {
    // glov_particles.preloadParticleData(particle_data);
    vshader = shaders.create(gl.VERTEX_SHADER, fs.readFileSync(`${__dirname}/shaders/robo.vp`, 'utf8'));
    fshader = shaders.create(gl.FRAGMENT_SHADER, fs.readFileSync(`${__dirname}/shaders/robo.fp`, 'utf8'));
    effects.registerShader('copy_glow', {
      fp: fs.readFileSync(`${__dirname}/shaders/effect_copy_glow.fp`, 'utf8'),
    });
  }

  // Around 0,0
  function genTriangleFan(verts) {
    return geom.create([
      [shaders.semantic.POSITION, gl.FLOAT, 2, false],
      [shaders.semantic.COLOR, gl.FLOAT, 1, false],
    ], verts, null, geom.TRIANGLE_FAN);
  }

  function genSegmentedRect(widths, heights, color, z) {
    let num_segments = widths.length - 1;
    let verts = new Float32Array((2 + (num_segments + 1) * 2) * 3);
    let vidx = 0;
    verts[vidx++] = 0;
    verts[vidx++] = heights[0] + (heights[num_segments] - heights[0]) / 2;
    verts[vidx++] = 0;
    // down left side
    for (let ii = 0; ii < num_segments + 1; ++ii) {
      verts[vidx++] = -widths[ii] / 2;
      verts[vidx++] = heights[ii];
      verts[vidx++] = 1;
    }
    // up right side
    for (let ii = num_segments; ii >= 0; --ii) {
      verts[vidx++] = widths[ii] / 2;
      verts[vidx++] = heights[ii];
      verts[vidx++] = 1;
    }
    // repeat lower left vert
    verts[vidx++] = -widths[0] / 2;
    verts[vidx++] = heights[0];
    verts[vidx++] = 1;
    assert(vidx === verts.length);
    let r = genTriangleFan(verts);
    r.color1 = color;
    r.z = z;
    r.h = heights[heights.length - 1];
    return r;
  }

  function genFanFromBorder(source, c0, color, z) {
    let num_verts = 2 + source.length;
    let verts = new Float32Array(num_verts * 3);
    let vidx = 0;
    let x_sum = 0;
    let y_sum = 0;
    let y_max = -Infinity;
    for (let ii = 0; ii < source.length; ++ii) {
      x_sum += source[ii][0];
      y_sum += source[ii][1];
      y_max = max(y_max, source[ii][1]);
    }
    verts[vidx++] = x_sum / source.length;
    verts[vidx++] = y_sum / source.length;
    verts[vidx++] = c0;
    for (let ii = 0; ii < source.length; ++ii) {
      verts[vidx++] = source[ii][0];
      verts[vidx++] = source[ii][1];
      verts[vidx++] = 1;
    }
    verts[vidx++] = source[0][0];
    verts[vidx++] = source[0][1];
    verts[vidx++] = 1;
    assert(vidx === verts.length);
    let r = genTriangleFan(verts);
    r.color1 = color;
    r.z = z;
    r.h = y_max;
    return r;
  }

  function Node() {
    this.rel_xform = mat2d(); // relative attachment to parent
    this.xform = mat2d(); // temporary
    this.geom = [];
    this.weps = [];
    this.children = [];
  }

  function wep(x, y, z, r, c) {
    return {
      pos_temp: vec2(),
      pos: vec3(x, y, z),
      radius: r,
      spread: 0.95,
      color: c,
    };
  }

  function shift(arr, delta) {
    for (let ii = 0; ii < arr.length; ++ii) {
      arr[ii] += delta;
    }
  }

  function mirror(verts) {
    for (let ii = 0; ii < verts.length; ++ii) {
      verts[ii][0] = -verts[ii][0];
    }
    for (let ii = 0; ii < verts.length / 2; ++ii) {
      let t = verts[ii];
      verts[ii] = verts[verts.length - ii - 1];
      verts[verts.length - ii - 1] = t;
    }
  }

  const SKIP_LRMS = 0x8;
  const Z_WEAPON = 300;
  let lrys = 1;
  function addWeapon(node, rvalue, parent_w, parent_h, yoffs, weapon_type, lrm_y_shrink, weapon_skip_mask) {
    lrm_y_shrink = lrys;
    if (!weapon_type || (weapon_skip_mask & (1 << (weapon_type - 1)))) { // eslint-disable-line no-bitwise
      return false;
    }
    if (weapon_type === 0) {
      // none
      return false;
    } else if (weapon_type === 1) { // 0x1
      // large laser
      let r = min(7 + rvalue * 4, parent_w * 0.18);
      node.weps.push(wep(0, yoffs, 171, r, color_large_laser));
    } else if (weapon_type === 2) { // 0x2
      // medium laser
      let r = 4 + rvalue * 3;
      node.weps.push(wep(0, yoffs, 171, r, color_med_laser));
    } else if (weapon_type === 3) { // 0x4
      // small lasers
      let r = 3;
      let s = parent_w / 6;
      node.weps.push(wep(-s, yoffs, 171, r, color_small_laser));
      node.weps.push(wep(s, yoffs, 171, r, color_small_laser));
    } else if (weapon_type === 4) { // 0x8
      // LRMs
      let r = 3;
      let w = 2;
      let h;
      if (lrm_y_shrink <= 0.5) {
        h = 1 + floor(rvalue * 2);
      } else {
        h = 2 + floor(rvalue * 2);
      }
      let sx = parent_w / 3 / w;
      let sy = parent_h / 3 / h;
      let x0 = -sx * (w - 1);
      let y0 = sy * (h - 1);
      sy *= lrm_y_shrink;
      for (let ii = 0; ii < w; ++ii) {
        for (let jj = 0; jj < h; ++jj) {
          let ww = wep(x0 + ii * sx * 2, y0 - sy * jj * 2 + yoffs, Z_WEAPON, r, color_lrm);
          node.weps.push(ww);
        }
      }
    } else {
      return false;
    }
    return true;
  }

  function genRobo(idx) {
    let rand = random_seed.create(`robo${idx}`);

    const NUM_WEAPONS = 5;
    function addWeaponPair(node1, node2, w, h, yoffs, lrm_y_shrink, weapon_skip_mask, retries) {
      let weapon_type = rand(NUM_WEAPONS);
      let weapon_rvalue = rand.random();
      while (!addWeapon(node1, weapon_rvalue, w, h, yoffs, weapon_type, lrm_y_shrink, weapon_skip_mask) && retries) {
        weapon_type = rand(NUM_WEAPONS);
        --retries;
      }
      if (!node2) {
        return;
      }
      let other = rand(5);
      if (other < 3) {
        // Use same
        addWeapon(node2, weapon_rvalue, w, h, yoffs, weapon_type, lrm_y_shrink, weapon_skip_mask);
      } else if (other < 4) {
        // Use different
        weapon_type = rand(NUM_WEAPONS);
        weapon_rvalue = rand.random();
        // NO retries, slightly more likely to be one but not the other
        addWeapon(node2, weapon_rvalue, w, h, yoffs, weapon_type, lrm_y_shrink, weapon_skip_mask);
      }
    }

    let root = new Node();

    let pelvis_node = new Node();
    root.children.push(pelvis_node);
    // Possibly generate pelvis geometry
    let pelvis_height = 0;
    let has_pelvis = rand.random() < 0.75;
    let pelvis_color = color_black; //hsvToRGB(vec4(0,0,0,1), rand.floatBetween(0, 360), 1, 1);
    let pelvis_width;
    if (has_pelvis) {
      let pelvis_top_width = pelvis_width = 50 + rand(50);
      let pelvis_bottom_width = pelvis_top_width;
      if (rand.random() < 0.5) {
        // not square
        pelvis_bottom_width = rand.floatBetween(0.75 * pelvis_top_width, pelvis_top_width);
      }
      pelvis_height = 30 + rand(20);
      let pelvis = genSegmentedRect([pelvis_top_width, pelvis_bottom_width], [-pelvis_height/2, pelvis_height/2],
        pelvis_color, 105);
      pelvis_node.geom.push(pelvis);
    } else {
      pelvis_height = -(30 + rand(20));
    }


    let torso_segments = 1 + rand(2);
    let torso_widths = [];
    let torso_heights = [];
    let torso_offs = 10 + rand(20);
    for (let ii = 0; ii < torso_segments + 1; ++ii) {
      torso_widths.push(100 + rand(100));
      if (ii) {
        let prev_h = torso_heights[torso_heights.length - 1];
        torso_heights.push(prev_h + 100 + rand(50));
      } else {
        torso_heights.push(-torso_offs);
      }
    }
    let torso_node = new Node();
    m2translate(torso_node.rel_xform, identity_mat2d,
      [0, -torso_heights[torso_heights.length - 1] - pelvis_height / 2]);
    let torso_color = color_black; // hsvToRGB(vec4(0,0,0,1), rand.floatBetween(0, 360), 1, 1);
    let torso = genSegmentedRect(torso_widths, torso_heights, torso_color, 100);
    pelvis_node.children.push(torso_node);
    torso_node.geom.push(torso);

    let head_segments = 1 + rand(2);
    let head_widths = [];
    head_widths[0] = 30 + rand(30);
    head_widths[head_segments] = 30 + rand(20);
    let head_max_width = max(head_widths[0], head_widths[head_segments]);
    let head_min_width = min(head_widths[0], head_widths[head_segments]);
    for (let ii = 1; ii < head_segments; ++ii) {
      head_widths[ii] = head_max_width + rand(15);
    }
    let head_heights = [0];
    for (let ii = 1; ii <= head_segments; ++ii) {
      let prev_h = head_heights[head_heights.length-1];
      head_heights.push(prev_h + 30 + rand(20));
    }
    let head_size = head_heights[head_heights.length - 1];
    let head_origin = head_heights[1] / 2;
    shift(head_heights, -head_origin); // origin is middle of top segment
    let head_node = new Node();
    m2translate(head_node.rel_xform, identity_mat2d, [0, -rand(head_size - head_origin)]);
    head_node.rel_xform_base = head_node.rel_xform.slice(0);
    let bob_rate = rand.floatBetween(0.0001, 0.001);
    let bob_mag = rand.floatBetween(3, 10);
    let bob_offs = rand.floatBetween(0, PI * 2);
    head_node.tick = function () {
      let t = engine.getFrameTimestamp();
      m2translate(this.rel_xform, this.rel_xform_base, [0, sin(t * bob_rate + bob_offs) * bob_mag]);
    };
    let head_color = color_black; // hsvToRGB(vec4(0,0,0,1), rand.floatBetween(0, 360), 1, 1);
    let head = genSegmentedRect(head_widths, head_heights, head_color, 110);
    head_node.geom.push(head);
    torso_node.children.push(head_node);

    if (head_segments > 1) {
      let weapon_type = rand(NUM_WEAPONS);
      let weapon_rvalue = rand.random();
      let last_h = head_heights[head_segments];
      let last2_h = head_heights[head_segments - 1];
      addWeapon(head_node, weapon_rvalue, head_min_width, last_h - last2_h,
        (last_h + last2_h) / 2, weapon_type, 0.5, 0);
    }

    let max_eye_size = head_min_width / 2;
    let eye_width = rand.floatBetween(max_eye_size * 0.75, max_eye_size);
    let eye_width_o2 = eye_width / 2;
    let eye_height_o2 = rand.floatBetween(eye_width / 3, eye_width) / 2;
    let eye_verts = [
      [eye_width_o2, -eye_height_o2],
      [-eye_width_o2, -eye_height_o2],
      [rand.floatBetween(-eye_width_o2, eye_width_o2), eye_height_o2],
    ];
    if (rand.random() < 0.5) {
      eye_verts.push(
        [rand.floatBetween(-eye_width_o2, eye_width_o2), eye_height_o2]
      );
      if (eye_verts[3][0] < eye_verts[2][0]) {
        let t = eye_verts[3][0];
        eye_verts[3][0] = eye_verts[2][0];
        eye_verts[2][0] = t;
      }
    }
    let eye_c0 = rand.floatBetween(0.90, 0.98);
    let eye_color = hsvToRGB(vec4(0,0,0,1), rand.floatBetween(0, 360), 1, 1);
    let eye = genFanFromBorder(eye_verts, eye_c0, eye_color, 120);
    let eye_rot = rand.floatBetween(-15 / 180 * PI, 40 / 180 * PI);
    let eye_node = new Node();
    let max_sep = max_eye_size - eye_width;
    let eye_sep = rand.floatBetween(max_sep * 0.3, max_sep * 0.7) + eye_width_o2;
    m2translate(eye_node.rel_xform, identity_mat2d, [-eye_sep, 0]);
    m2rot(eye_node.rel_xform, eye_node.rel_xform, eye_rot);
    eye_node.geom.push(eye);
    head_node.children.push(eye_node);

    eye_node = new Node();
    m2translate(eye_node.rel_xform, identity_mat2d, [eye_sep, 0]);
    m2rot(eye_node.rel_xform, eye_node.rel_xform, -eye_rot);
    mirror(eye_verts);
    eye = genFanFromBorder(eye_verts, eye_c0, eye_color, 120);
    eye_node.geom.push(eye);
    head_node.children.push(eye_node);

    // Possibly generate shoulders (always make node, maybe no geom, no offset to child)
    let has_arms = rand.random() < 0.75;
    let arm_width = 25 + rand(20);
    let shoulder_offs = torso_widths[0] / 2 + arm_width / 2 + 5 + rand(10);
    let shoulder_w = arm_width + 20 + rand(30) + (has_arms ? 0 : 20);
    let shoulder_h = rand.floatBetween(shoulder_w, shoulder_w * 1.5);
    let shoulder_node_right = new Node();
    m2translate(shoulder_node_right.rel_xform, identity_mat2d, [-shoulder_offs, 0]);
    let shoulder_node_left = new Node();
    m2translate(shoulder_node_left.rel_xform, identity_mat2d, [shoulder_offs, 0]);
    torso_node.children.push(shoulder_node_left, shoulder_node_right);
    let lrm_y_shrink = 1;
    function genShoulder() {
      let shoulder_type = rand(4);
      if (shoulder_type === 0) {
        // none
        return null;
      } else if (shoulder_type === 1) {
        // square
        return [
          [shoulder_w / 2, -shoulder_h / 2],
          [-shoulder_w / 2, -shoulder_h / 2],
          [-shoulder_w / 2, shoulder_h / 2],
          [shoulder_w / 2, shoulder_h / 2],
        ];
      } else if (shoulder_type === 2) {
        // pentagonal
        let cut_h = rand.floatBetween(0, shoulder_w);
        let cut_v = rand.floatBetween(0, shoulder_h);
        lrm_y_shrink = min(lrm_y_shrink, 1 - max(0, cut_h/shoulder_w - 0.5));
        return [
          [shoulder_w / 2, -shoulder_h / 2],
          [-shoulder_w / 2 + cut_h, -shoulder_h / 2],
          [-shoulder_w / 2, -shoulder_h / 2 + cut_v],
          [-shoulder_w / 2, shoulder_h / 2],
          [shoulder_w / 2, shoulder_h / 2],
        ];
      } else {
        // hexagonal
        let cut_h1 = rand.floatBetween(0, shoulder_w);
        let cut_h2 = rand.floatBetween(0, shoulder_w);
        let cut_v = rand.floatBetween(0, shoulder_h * 0.4);
        lrm_y_shrink = min(lrm_y_shrink, 1 - max(0, cut_h1/shoulder_w - 0.5));
        return [
          [shoulder_w / 2, -shoulder_h / 2],
          [-shoulder_w / 2 + cut_h1, -shoulder_h / 2],
          [-shoulder_w / 2, -shoulder_h / 2 + cut_v],
          [-shoulder_w / 2, shoulder_h / 2 - cut_v],
          [-shoulder_w / 2 + cut_h2, shoulder_h / 2],
          [shoulder_w / 2, shoulder_h / 2],
        ];
      }
    }
    let shoulder_verts = genShoulder();
    let shoulder_color = color_black; //  hsvToRGB(vec4(0,0,0,1), rand.floatBetween(0, 360), 1, 1);
    if (shoulder_verts) {
      let shoulder = genFanFromBorder(shoulder_verts, 0.5, shoulder_color, 170);
      shoulder_node_right.geom.push(shoulder);

      if (rand(9) === 0) {
        shoulder_verts = genShoulder() || shoulder_verts;
      }
      if (shoulder_verts) {
        mirror(shoulder_verts);
        shoulder = genFanFromBorder(shoulder_verts, 0.5, shoulder_color, 170);
        shoulder_node_left.geom.push(shoulder);
      }

      // add weapons
      addWeaponPair(shoulder_node_left, shoulder_node_right, shoulder_w, shoulder_h, 0, lrm_y_shrink, 0, 0);
    }

    // Generate legs either out from torso, out from pelvis, or down from shoulders
    let upper_leg_node_left = new Node();
    let upper_leg_node_right = new Node();
    let upper_leg_len = 60 + rand(40);
    let leg_width = 30 + rand(30);
    let upper_leg_offs = rand(10) + leg_width / 2;
    let leg_axel_radius = 10 + rand(6);
    let upper_leg_voffs = min(abs(pelvis_height) / 2, leg_axel_radius);
    if (has_pelvis) {
      upper_leg_offs += pelvis_width / 2;
    } else {
      upper_leg_voffs += 30;
      upper_leg_offs += torso_widths[torso_widths.length - 1] / 2;
    }
    m2translate(upper_leg_node_right.rel_xform, identity_mat2d, [-upper_leg_offs, -upper_leg_voffs]);
    m2translate(upper_leg_node_left.rel_xform, identity_mat2d, [upper_leg_offs, -upper_leg_voffs]);
    pelvis_node.children.push(upper_leg_node_right, upper_leg_node_left);

    upper_leg_node_right.geom.push(genSegmentedRect([leg_width, leg_width], [0, upper_leg_len], shoulder_color, 120));
    upper_leg_node_left.geom.push(genSegmentedRect([leg_width, leg_width], [0, upper_leg_len], shoulder_color, 120));

    // Possibly generate second leg segment
    let lower_leg_node_left = new Node();
    let lower_leg_node_right = new Node();
    m2translate(lower_leg_node_right.rel_xform, identity_mat2d, [0, upper_leg_len + 10]);
    m2translate(lower_leg_node_left.rel_xform, identity_mat2d, [0, upper_leg_len + 10]);
    upper_leg_node_left.children.push(lower_leg_node_left);
    upper_leg_node_right.children.push(lower_leg_node_right);
    let has_lower_leg = rand.random() < 0.75;
    let lower_leg_len = -10;
    if (has_lower_leg) {
      lower_leg_len = 60 + rand(40);
      let shrink = rand.floatBetween(0.75, 1);
      lower_leg_node_right.geom.push(genSegmentedRect([leg_width, leg_width * shrink],
        [0, lower_leg_len], shoulder_color, 120));
      lower_leg_node_left.geom.push(genSegmentedRect([leg_width, leg_width * shrink],
        [0, lower_leg_len], shoulder_color, 120));
    }

    // Generate Feet
    let foot_node_left = new Node();
    let foot_node_right = new Node();
    lower_leg_node_left.children.push(foot_node_left);
    lower_leg_node_right.children.push(foot_node_right);
    let foot_type = rand(2);
    let foot_height = 30 + rand(20);
    let foot_offs = -10;
    let foot_width_top;
    let foot_width_bottom;
    if (foot_type === 0) {
      // triangular/quadrilateral
      foot_width_top = rand(70);
      foot_width_bottom = rand.floatBetween(max(leg_width, foot_width_top), 120);
    } else {
      // squarish
      foot_width_top = rand.floatBetween(50, 70);
      foot_width_bottom = rand.floatBetween(max(leg_width, foot_width_top), 70);
      foot_offs = 2 + rand(5);
    }
    m2translate(foot_node_right.rel_xform, identity_mat2d, [0, lower_leg_len + foot_offs]);
    m2translate(foot_node_left.rel_xform, identity_mat2d, [0, lower_leg_len + foot_offs]);
    foot_node_right.geom.push(genSegmentedRect([foot_width_top, foot_width_bottom],
      [0, foot_height], pelvis_color, 120));
    foot_node_left.geom.push(genSegmentedRect([foot_width_top, foot_width_bottom],
      [0, foot_height], pelvis_color, 120));


    // Possibly Generate arms going out or down, depending on shoulders and random, and not overlapping legs
    if (has_arms) {
      let upper_arm_len = 60 + rand(40);
      shoulder_node_left.geom.push(genSegmentedRect([arm_width, arm_width],
        [0, upper_arm_len], pelvis_color, 150));
      shoulder_node_right.geom.push(genSegmentedRect([arm_width, arm_width],
        [0, upper_arm_len], pelvis_color, 150));
      let has_lower_arm = rand.random() < 0.75;
      if (has_lower_arm) {
        let lower_arm_len = rand.floatBetween(20, upper_arm_len);
        let lower_arm_node_left = new Node();
        let lower_arm_node_right = new Node();
        shoulder_node_left.children.push(lower_arm_node_left);
        shoulder_node_right.children.push(lower_arm_node_right);
        m2translate(lower_arm_node_right.rel_xform, identity_mat2d, [0, upper_arm_len + 5]);
        m2translate(lower_arm_node_left.rel_xform, identity_mat2d, [0, upper_arm_len + 5]);
        lower_arm_node_left.geom.push(genSegmentedRect([arm_width, arm_width],
          [0, lower_arm_len], pelvis_color, 150));
        lower_arm_node_right.geom.push(genSegmentedRect([arm_width, arm_width],
          [0, lower_arm_len], pelvis_color, 150));

        addWeaponPair(lower_arm_node_left, lower_arm_node_right, arm_width, lower_arm_len, lower_arm_len / 2, 1,
          SKIP_LRMS, 5);
      }
    }

    // Add lots of weapons
    // Possibly generate axles going out between pelvis/torso and legs, possibly very large in pelvis

    let walk_rate = rand.floatBetween(0.001, 0.004);
    let walk_offs = rand.floatBetween(0, PI * 2);
    upper_leg_node_left.rel_xform_base = upper_leg_node_left.rel_xform.slice(0);
    upper_leg_node_right.rel_xform_base = upper_leg_node_right.rel_xform.slice(0);
    lower_leg_node_left.rel_xform_base = lower_leg_node_left.rel_xform.slice(0);
    lower_leg_node_right.rel_xform_base = lower_leg_node_right.rel_xform.slice(0);
    foot_node_left.rel_xform_base = foot_node_left.rel_xform.slice(0);
    foot_node_right.rel_xform_base = foot_node_right.rel_xform.slice(0);
    pelvis_node.tick = function () {
      let t = engine.getFrameTimestamp();
      let amt = 0.15;
      let scale = 1 - amt + sin(t * walk_rate + walk_offs) * amt;
      let amt_lower = 0.05;
      let scale_lower = 1 - amt_lower + sin(t * walk_rate + walk_offs) * amt_lower;
      m2scale(upper_leg_node_left.rel_xform, upper_leg_node_left.rel_xform_base, [1, scale]);
      m2scale(lower_leg_node_left.rel_xform, lower_leg_node_left.rel_xform_base, [1, 1/scale * scale_lower]);
      m2scale(foot_node_left.rel_xform, foot_node_left.rel_xform_base, [1, 1/scale_lower]);
      scale = 1 - amt + sin(t * walk_rate + walk_offs + PI) * amt;
      scale_lower = 1 - amt_lower + sin(t * walk_rate + walk_offs + PI) * amt_lower;
      m2scale(upper_leg_node_right.rel_xform, upper_leg_node_right.rel_xform_base, [1, scale]);
      m2scale(lower_leg_node_right.rel_xform, lower_leg_node_right.rel_xform_base, [1, 1/scale * scale_lower]);
      m2scale(foot_node_right.rel_xform, foot_node_right.rel_xform_base, [1, 1/scale_lower]);
    };

    root.speed = rand.floatBetween(0.5, 1);
    root.speed = 0.25 + (walk_rate - 0.001) / 0.004 * (0.65 - 0.25);
    root.ypos = rand.floatBetween(0, 1);

    return root;
  }

  let clip_space = vec4();
  let camera_space = vec4();
  //let color0 = vec4(0.55,0.57,0.55,1);
  let color0 = vec4(0,0,0,1);
  function drawTriFan(mat, z, obj) {
    sprites.queuefn(z, function () {
      // let color0 = v4mul(vec4(), obj.color1, [0.5, 0.5, 0.5, 1]);
      shaders.bind(vshader, fshader, {
        model_mat: mat,
        color0,
        color1: obj.color1,
      });
      obj.draw();
    });
  }

  function drawNode(parent_xform, node, zoffs) {
    m2mul(node.xform, parent_xform, node.rel_xform);
    if (DRAW_NODES) {
      ui.drawLine(node.xform[4] - 3, node.xform[5] - 3, node.xform[4] + 3, node.xform[5] + 3, 1000, 1, 0.95, unit_vec);
      ui.drawLine(node.xform[4] + 3, node.xform[5] - 3, node.xform[4] - 3, node.xform[5] + 3, 1000, 1, 0.95, unit_vec);
    }
    for (let ii = 0; ii < node.geom.length; ++ii) {
      drawTriFan(node.xform, node.geom[ii].z + zoffs, node.geom[ii]);
    }
    for (let ii = 0; ii < node.weps.length; ++ii) {
      let ww = node.weps[ii];
      m2v2transform(ww.pos_temp, ww.pos, node.xform);
      ui.drawCircle(ww.pos_temp[0], ww.pos_temp[1], ww.pos[2] + zoffs, ww.radius, ww.spread, ww.color);
    }
    for (let ii = 0; ii < node.children.length; ++ii) {
      drawNode(node.xform, node.children[ii], zoffs);
    }
  }

  function freeNode(node) {
    for (let ii = 0; ii < node.geom.length; ++ii) {
      node.geom[ii].dispose();
    }
    for (let ii = 0; ii < node.children.length; ++ii) {
      freeNode(node.children[ii]);
    }
  }

  function tickAndGetMaxY(parent_xform, node) {
    if (node.tick) {
      node.tick();
    }
    m2mul(node.xform, parent_xform, node.rel_xform);
    let r = -Infinity; // node.xform[5];
    for (let ii = 0; ii < node.geom.length; ++ii) {
      r = max(r, node.xform[5] + node.geom[ii].h);
    }
    for (let ii = 0; ii < node.children.length; ++ii) {
      r = max(r, tickAndGetMaxY(node.xform, node.children[ii]));
    }
    return r;
  }

  function doPostEffect() {
    let orig = engine.captureFramebuffer();
    effects.applyCopy({
      source: orig,
      shader: 'copy_glow',
    });
    effects.applyGaussianBlur({
      source: engine.captureFramebuffer(),
      blur: 1,
      max_size: 1024,
      min_size: 512,
      glow: 1.5,
    });
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    effects.applyCopy({
      source: orig,
    });
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }


  let ROBO_W = 3;
  let ROBO_H = 3;
  let robos;
  let mat_base = mat2d();
  let last_light = -Infinity;
  let lightning_countdown = 0;
  let robo_idx = 6*9;
  let ambiance = true;
  let endless = true;

  function initRoboGrid() {
    robos = [];
    let idx = 0;
    for (let ii = 0; ii < ROBO_W; ++ii) {
      for (let jj = ROBO_H - 1; jj >= 0; --jj) {
        let r = genRobo(robo_idx++);
        r.xpos = (idx++) / (ROBO_W * ROBO_H - 1);
        if (endless) {
          // keep r.ypos
        } else {
          r.ypos = (jj + 1) / ROBO_H;
        }

        robos.push(r);
      }
    }
  }

  function test(dt) {

    let randomize = false;
    let x = camera2d.x0();
    let y = 0;
    function optionButton(text) {
      let ret = ui.buttonText({ x, y, z: Z.UI, text });
      y += ui.button_height + 4;
      return ret;
    }
    if (optionButton('Randomize')) {
      randomize = true;
    }
    if (optionButton(`Ambiance: ${ambiance ? 'ON' : 'OFF'}`)) {
      ambiance = !ambiance;
    }
    if (optionButton(`Endless: ${endless ? 'ON' : 'OFF'}`)) {
      endless = !endless;
      initRoboGrid();
    }

    if (input.click()) {
      randomize = true;
    }

    if (randomize) {
      initRoboGrid();
    }

    lightning_countdown -= dt;
    if (lightning_countdown < 0) {
      last_light = engine.global_timer;
      lightning_countdown = 10 + Math.random() * 3000;
    }
    let time_since_light = engine.global_timer - last_light;
    let cv = max(0, 1 - time_since_light / 250) * 0.2;

    if (!ambiance) {
      cv = 0.9;
    }
    gl.clearColor(cv,cv,cv, 1);

    clip_space[0] = 2 / engine.viewport[2];
    clip_space[1] = -2 / engine.viewport[3];
    clip_space[2] = -1;
    clip_space[3] = 1;
    camera_space[0] = camera2d.data[4] * clip_space[0];
    camera_space[1] = camera2d.data[5] * clip_space[1];
    camera_space[2] = -camera2d.data[0] * camera2d.data[4] * clip_space[0] - 1;
    camera_space[3] = -camera2d.data[1] * camera2d.data[5] * clip_space[1] + 1;

    for (let ii = robos.length - 1; ii >= 0; --ii) {
      let robo = robos[ii];
      if (endless) {
        robo.ypos += robo.speed * dt * 0.0001;
        if (robo.ypos > 1.34) {
          ridx(robos, ii);
          let new_robo = genRobo(robo_idx++);
          new_robo.xpos = robo.xpos;
          new_robo.ypos = 0;
          robos.push(new_robo);
          freeNode(robo);
          robo = new_robo;
        }
      }
      let max_y = tickAndGetMaxY(identity_mat2d, robo);
      let scale = 0.6;
      if (endless) {
        robo.x = camera2d.x0() + (0.1 + 0.8 * robo.xpos) * camera2d.w();
      } else {
        robo.x = 150 + 700 * robo.xpos;
      }
      robo.y = camera2d.y0() + robo.ypos * camera2d.h();
      m2translate(mat_base, identity_mat2d, [robo.x, robo.y - max_y * scale]);
      m2scale(mat_base, mat_base, [scale, scale]);
      drawNode(mat_base, robo, robo.y);
      // ui.drawLine(150 + 300 * ii - 30, 300 + 300 * jj, 150 + 300 * ii + 30, 300 + 300 * jj, 1000, 3,0.95,unit_vec);
    }

    sprites.queuefn(Z.POST, doPostEffect);
  }

  function testInit(dt) {
    shaders.addGlobal('camera_space', camera_space);
    initRoboGrid();
    engine.setState(test);
    test(dt);
  }

  initGraphics();
  engine.setState(testInit);
}
