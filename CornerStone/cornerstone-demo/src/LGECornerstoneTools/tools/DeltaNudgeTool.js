import EVENTS from '../events.js';
import external from '../externalModules.js';
import toolColors from '../stateManagement/toolColors.js';
import drawHandles from '../drawing/drawHandles.js';
import { state } from '../store/index.js';
import { getToolState } from '../stateManagement/toolState.js';
import { clipToBox } from '../util/clip.js';
import getToolForElement from '../store/getToolForElement.js';
import BaseTool from './base/BaseTool.js';
import { hideToolCursor, setToolCursor } from '../store/setToolCursor.js';
import { deltaNudgeCursor } from './cursors/index.js';

import freehandUtils from '../util/freehand/index.js';
import { convertToFalseColorImage } from 'cornerstone-core';

const { FreehandHandleData } = freehandUtils;
var DILATE = 1,
  ERODE = -1,
  testElement = -1,
  prevScale = -1;
var editMode = true;

/**
 * @public
 * @class DeltaNudgeTool
 * @memberof Tools
 *
 * @classdesc Tool for easily sculpting annotations drawn with
 * the FreehandRoiTool.
 * @extends Tools.Base.BaseTool
 */
export default class DeltaNudgeTool extends BaseTool {
  constructor(props = {}) {
    const defaultProps = {
      name: 'DeltaNudgeTool',
      referencedToolName: 'FreehandRoi',
      supportedInteractionTypes: ['Mouse', 'Touch', 'DoubleTap'],
      mixins: ['activeOrDisabledBinaryTool'],
      configuration: getDefaultDeltaNudgeToolConfiguration(),
      svgCursor: deltaNudgeCursor,
    };

    super(props, defaultProps);
    this.pSize = 1;
    this.min_radius = 10;
    this.radius = 52;
    this.max_edit = 1;
    this.oldCtr = 0;
    this.ctr = [];
    this.bPtsEdited = [];
    this.opType = 0;
    this.ARC_SIZE = 5;
    this.pixelSize = 1;
    this.direction = [];
    this.INNER_RAD = 0.5;
    this.updateOnMouseMove = true;
    this.isMultiPartTool = true;
    this.referencedToolName = this.initialConfiguration.referencedToolName;

    this._active = false;

    // Create bound functions for private event loop.
    this.activeMouseUpCallback = this.activeMouseUpCallback.bind(this);
    this.activeTouchEndCallback = this.activeTouchEndCallback.bind(this);
    this.activeMouseDragCallback = this.activeMouseDragCallback.bind(this);
  }

  renderToolData(evt) {
    const eventData = evt.detail;
    if (this.configuration.currentTool === null) {
      return false;
    }

    const element = eventData.element;
    const config = this.configuration;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[config.currentTool];

    if (!data) {
      return false;
    }

    if (this._active) {
      const context = eventData.canvasContext.canvas.getContext('2d');
      var scale =
        external.cornerstone.getEnabledElement(element).viewport.scale;

      const options = {
        color: this.configuration.dragColor,
        fill: null,
        handleRadius: 32 / scale,
        name: 'DeltaNudgeTool',
      };
      const options2 = {
        color: this.configuration.dragColor,
        fill: null,
        handleRadius: 52 / scale,
        name: 'DeltaNudgeTool',
      };

      drawHandles(
        context,
        eventData,
        this.configuration.mouseLocation.handles,
        options
      );

      drawHandles(
        context,
        eventData,
        this.configuration.mouseLocation.handles,
        options2
      );
    } else if (this.configuration.showCursorOnHover && !this._recentTouchEnd) {
      this._renderHoverCursor(evt);
    }
  }

  doubleClickCallback(evt) {
    const eventData = evt.detail;

    this._selectFreehandTool(eventData);
    external.cornerstone.updateImage(eventData.element);
  }

  doubleTapCallback(evt) {
    const eventData = evt.detail;

    this._selectFreehandTool(eventData);
    external.cornerstone.updateImage(eventData.element);
  }

  preTouchStartCallback(evt) {
    this._initialiseSculpting(evt);

    return true;
  }

  /**
   * Event handler for MOUSE_DOWN.
   *
   * @param {Object} evt - The event.
   * @returns {boolean}
   */
  preMouseDownCallback(evt) {
    if (!this.options.mouseButtonMask.includes(evt.detail.buttons)) {
      return;
    }

    this._initialiseSculpting(evt);

    return true;
  }

  /**
   * Event handler for MOUSE_DRAG during the active loop.
   *
   * @event
   * @param {Object} evt - The event.
   * @returns {void}
   */
  activeMouseDragCallback(evt) {
    const config = this.configuration;

    if (!this._active) {
      return;
    }

    const eventData = evt.detail;
    const toolState = getToolState(eventData.element, this.referencedToolName);

    if (!toolState) {
      return;
    }

    const points = toolState.data[config.currentTool].handles.points;

    // Set the mouseLocation handle
    this._getMouseLocation(eventData);
    this._sculpt(eventData, points);

    // Update the image
    external.cornerstone.updateImage(eventData.element);
  }

  /**
   * Event handler for MOUSE_UP during the active loop.
   *
   * @param {Object} evt - The event.
   * @returns {void}
   */
  activeMouseUpCallback(evt) {
    this._activeEnd(evt);
  }

  /**
   * Event handler for TOUCH_END during the active loop.
   *
   * @param {Object} evt - The event.
   * @returns {void}
   */
  activeTouchEndCallback(evt) {
    this._activeEnd(evt);

    this._deselectAllTools(evt);
    this._recentTouchEnd = true;
  }

  _activeEnd(evt) {
    const eventData = evt.detail;
    const element = eventData.element;

    const config = this.configuration;

    this._active = false;

    state.isMultiPartToolActive = false;

    this._getMouseLocation(eventData);
    this._invalidateToolData(eventData);

    config.mouseUpRender = true;

    this._deactivateSculpt(element);

    // Update the image
    external.cornerstone.updateImage(eventData.element);

    preventPropagation(evt);
  }

  /**
   * Renders the cursor
   *
   * @private
   * @param  {type} evt description
   * @returns {void}
   */
  _renderHoverCursor(evt) {
    const eventData = evt.detail;
    const element = eventData.element;
    const context = eventData.canvasContext.canvas.getContext('2d');

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[this.configuration.currentTool];

    this._recentTouchEnd = false;

    let coords;

    if (this.configuration.mouseUpRender) {
      coords = this.configuration.mouseLocation.handles.start;
      this.configuration.mouseUpRender = false;
    } else {
      coords = state.mousePositionImage;
    }

    const freehandRoiTool = getToolForElement(element, this.referencedToolName);
    let radiusCanvas = freehandRoiTool.distanceFromPoint(element, data, coords);

    const canvasCoords = external.cornerstone.pixelToCanvas(element, coords);

    this.configuration.mouseLocation.handles.start.x = coords.x;
    this.configuration.mouseLocation.handles.start.y = coords.y;

    if (this.configuration.limitRadiusOutsideRegion) {
      const unlimitedRadius = radiusCanvas;

      radiusCanvas = this._limitCursorRadiusCanvas(eventData, radiusCanvas);

      // Fade if distant
      if (
        unlimitedRadius >
        this.configuration.hoverCursorFadeDistance * radiusCanvas
      ) {
        context.globalAlpha = this.configuration.hoverCursorFadeAlpha;
      }
    }

    var scale = external.cornerstone.getEnabledElement(element).viewport.scale;

    const options = {
      fill: null,
      color: this.configuration.hoverColor,
      handleRadius: 32 / scale,
      name: 'DeltaNudgeTool',
    };
    const options2 = {
      fill: null,
      color: this.configuration.hoverColor,
      handleRadius: 52 / scale,
      name: 'DeltaNudgeTool',
    };
    drawHandles(
      context,
      eventData,
      this.configuration.mouseLocation.handles,
      options
    );
    drawHandles(
      context,
      eventData,
      this.configuration.mouseLocation.handles,
      options2
    );
    if (this.configuration.limitRadiusOutsideRegion) {
      context.globalAlpha = 1.0; // Reset drawing alpha for other draw calls.
    }
  }

  /**
   * Event handler for NEW_IMAGE event.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  newImageCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to enabled.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  enabledCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to passive.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  passiveCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to disabled.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  disabledCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Select the freehand tool to be edited.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _selectFreehandTool(eventData) {
    const config = this.configuration;
    const element = eventData.element;
    const closestToolIndex = this._getClosestFreehandToolOnElement(
      element,
      eventData
    );

    if (closestToolIndex === undefined) {
      return;
    }

    config.currentTool = closestToolIndex;
    hideToolCursor(element);
  }

  /**
   * Activate the selected freehand tool and deactivate others.
   *
   * @private
   * @param {Object} element - The parent element of the freehand tool.
   * @param {Number} toolIndex - The ID of the freehand tool.
   * @returns {void}
   */
  _activateFreehandTool(element, toolIndex) {
    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data;
    const config = this.configuration;

    config.currentTool = toolIndex;

    for (let i = 0; i < data.length; i++) {
      if (i === toolIndex) {
        data[i].active = true;
      } else {
        data[i].active = false;
      }
    }
  }

  /**
   * Choose the tool radius from the mouse position relative to the active freehand
   * tool, and begin sculpting.
   *
   * @private
   * @param {Object} evt - The event.
   * @returns {void}
   */
  _initialiseSculpting(evt) {
    const eventData = evt.detail;
    const config = this.configuration;
    const element = eventData.element;

    if (config.currentTool === null) {
      this._selectFreehandTool(eventData);

      if (config.currentTool === null) {
        return;
      }
    }

    this._active = true;

    // Interupt event dispatcher
    state.isMultiPartToolActive = true;

    this._configureToolSize(eventData);
    this._getMouseLocation(eventData);

    this._activateFreehandTool(element, config.currentTool);
    this._activateSculpt(element);

    external.cornerstone.updateImage(eventData.element);
  }

  //Uses the radiusImage (toolSize) variable to handle the push
  /**
   * Sculpts the freehand ROI with the circular freehandSculpter tool, moving,
   * adding and removing handles as necessary.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @param {Object} points - Array of points.
   * @returns {void}
   */
  _sculpt(eventData, points) {
    const config = this.configuration;

    this._sculptData = {
      element: eventData.element,
      image: eventData.image,
      mousePoint: eventData.currentPoints.image,
      points,
      toolSize: this._toolSizeImage,
      minSpacing: config.minSpacing,
      maxSpacing: Math.max(this._toolSizeImage, config.minSpacing * 2),
    };

    // Push existing handles radially away from tool.
    const pushedHandles = this._pushHandles();
    // Insert new handles in sparsely populated areas of the
    // Pushed part of the contour.

    // if (pushedHandles.first !== undefined) {
    //   this._insertNewHandles(pushedHandles);
    //   // If any handles have been pushed very close together or even overlap,
    //   // Combine these into a single handle.
    //   this._consolidateHandles();
    // }
  }

  /**
   * _findCircle - To compute the equation of the circle for given points(p1 (x1,y1), p2 (x2,y2), p3 (x3,y3))
   *  Input:  Three points (float)
   * Output: 1. Array containing the co-ordinates of centre of the circle (float)
             2. Radius of the circle (float)
   */

  _findCircle(p1, p2, p3) {
    var x1 = p1.x,
      y1 = p1.y,
      x2 = p2.x,
      y2 = p2.y,
      x3 = p3.x,
      y3 = p3.y;

    var t1 = Math.abs(x1 - x2) <= 2 && Math.abs(y1 - y2) <= 2;
    var t2 = Math.abs(x1 - x3) <= 2 && Math.abs(y1 - y3) <= 2;
    var t3 = Math.abs(x3 - x2) <= 2 && Math.abs(y3 - y2) <= 2;
    if (t1 || t2 || t3) {
      var ret = [x2, y2, 0];
      return ret;
    }

    var x12 = x1 - x2;
    var x13 = x1 - x3;

    var y12 = y1 - y2;
    var y13 = y1 - y3;

    var y31 = y3 - y1;
    var y21 = y2 - y1;

    var x31 = x3 - x1;
    var x21 = x2 - x1;

    // x1^2 - x3^2
    var sx13 = Math.pow(x1, 2) - Math.pow(x3, 2);

    // y1^2 - y3^2
    var sy13 = Math.pow(y1, 2) - Math.pow(y3, 2);

    // x2^2 - x1^2
    var sx21 = Math.pow(x2, 2) - Math.pow(x1, 2);

    // y2^2 - y1^2
    var sy21 = Math.pow(y2, 2) - Math.pow(y1, 2);

    var f =
      (sx13 * x12 + sy13 * x12 + sx21 * x13 + sy21 * x13) /
      (2 * (y31 * x12 - y21 * x13));

    var g =
      (sx13 * y12 + sy13 * y12 + sx21 * y13 + sy21 * y13) /
      (2 * (x31 * y12 - x21 * y13));

    var c = -Math.pow(x1, 2) - Math.pow(y1, 2) - 2 * g * x1 - 2 * f * y1;

    // eqn of circle be x^2 + y^2 + 2*g*x + 2*f*y + c = 0
    // where centre is (h = -g, k = -f) and
    // radius r as r^2 = h^2 + k^2 - c
    var h = -g;
    var k = -f;
    var sqr_of_r = h * h + k * k - c;

    // r is the radius
    var r = Math.round(Math.sqrt(sqr_of_r), 5);
    return [h, k, r];
  }

  /**
   * _distance - Calculating the distance between point p1 and p2
   *  Input:  Two points (float)
   * Output:  Distance (float)
   */

  _distance(p1, p2) {
    const { element } = this._sculptData;
    const p1Canvas = external.cornerstone.pixelToCanvas(element, p1);
    const p2Canvas = external.cornerstone.pixelToCanvas(element, p2);

    //distance in canvas units
    const distanceToHandleCanvas = external.cornerstoneMath.point.distance(
      p1Canvas,
      p2Canvas
    );
    var normalDistance = Math.sqrt(
      Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)
    );
    return distanceToHandleCanvas;
  }

  /**
   * _getPoint - To get the point co-ordinates
   *  Input: 1. dir -  direction of point in contour
             2. len - The total length of the curve
             3. cen - centre of the contour
   * Output:  Point co-ordinates(float)
   */

  _getPoint(dir, len, cen) {
    var ptDir = (dir * Math.PI) / 180.0;
    var relPt = [len * Math.cos(ptDir), len * Math.sin(ptDir)];
    return [cen.x + relPt.x, cen.y + relPt.y];
  }

  /**
   * _findClosestPtOnCtr - Finding the closest point on the contour in the direction specified by theta
   *  Input:  theta(angle) (float)
   * Output:  closest point on the contour (float)
   */

  _findClosestPtOnCtr(th) {
    var closest = -1,
      diff = 1000;
    this.direction.forEach((th2, i) => {
      if (Math.abs(th - th2) < diff) {
        closest = i;
        diff = Math.abs(th - th2);
      }
    });
    return closest;
  }

  /**
   * _findDir - Determining the direction of pt2 from pt1
   *  Input:  Two points (float)
   * Output:  theta(angle) (float)
   */

  _findDir(pt1, pt2) {
    var th = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x); // atan = tan ^ -1
    // ERROR CHECK - what happens if it is 0, 0
    th = (th * 180) / Math.PI;
    th = (360 + th) % 360;
    return th;
  }

  /**
   * _circleInCtr - Checks if circle is inside the contour 
   *  Input:  1. centre of the circle (Delta Nudge tool)
              2. contour
              3. centre of the contour
   * Output:  truth value of the check
   */

  _circleInCtr(cirCen, ctr, ctrCen = null) {
    if (ctrCen === null) {
      // To Compute the mean for (x,y)
      var xsum = 0,
        ysum = 0;
      ctr.forEach((pt) => {
        xsum += pt.x;
        ysum += pt.y;
      });
      ctrCen = ctr[0];
      ctrCen.x = xsum / ctr.length;
      ctrCen.y = ysum / ctr.length;

      var tempDir = [];
      ctr.forEach((pt) => {
        tempDir.push(this._findDir(ctrCen, pt));
      });
      this.direction = tempDir; // calculate the direction of all the points on the contour
    }

    if (this.direction.length === 0) {
      var tempDir = [];
      ctr.forEach((pt) => {
        tempDir.push(this._findDir(ctrCen, pt));
      });
      this.direction = tempDir; // calculate the direction of all the points on the contour
    }

    var cirDir = this._findDir(ctrCen, cirCen);
    // console.log(cirDir);
    var closestPt = ctr[this._findClosestPtOnCtr(cirDir)];
    if (this._distance(closestPt, ctrCen) >= this._distance(cirCen, ctrCen))
      return true;
    return false;
  }

  /**
   * _getCirclePts - To obtain points of the circle
   *  Input:  1. centre of the circle (Delta Nudge tool)
              2. radius
              3. first point
              4. last point
              5. number of points
   * Output:  return points on circle
   */

  _getCirclePts(cen, rad, fPt, lPt, numPts) {
    var pts = [];
    var dir1 = this._findDir(cen, fPt),
      dir2 = this._findDir(cen, lPt);
    if (Math.abs(dir1 - dir2) > 180) {
      if (dir1 > dir2) dir2 += 360;
      else dir2 -= 360;
    }

    var step = (dir2 - dir1) / (numPts + 1);
    var th = dir1 + step;
    while (Math.abs(th - dir2) > Math.abs(step * 1.1)) {
      var pt = this._getPoint((th + 360) % 360, rad, cen);
      pts.push(pt);
      th += step;
    }
    var tempPts = [];
    pts.forEach((pt) => {
      tempPts.push(pt);
    });
    return tempPts;
  }

  _adjustPt(mctr, cirCen, ctrCen, first, last, opType) {
    // opType is 1 for dilation and -1 for erosion
    // It shifts the point in the radial direction by 1 or 2 pixels, depending on distance of the point from circle centre
    var ctr = this.oldCtr.slice();
    var idx = ((first + last) / 2.0) % mctr.length;

    var dist = this._distance(ctr[idx], cirCen);
    // console.log('3\n');
    var delChange = dist > this.INNER_RAD * this.radius ? 1 : 2;
    delChange *= opType * this.max_edit * this.pixelSize; // length of the point from the circle centre is increased by this amount
    // if (delChange > 2) console.log('adjust contour: ', delChange);

    var maxD = this._distance(ctr[idx], ctrCen) + delChange;
    // console.log('4\n');
    var midPt = this._getPoint(this.direction[idx], maxD, ctrCen);

    if (last - first < this.ARC_SIZE) {
      return;
    }
    var ret = this._findCircle(
      this.ctr[first],
      midPt,
      this.ctr[last % mctr.length]
    );
    var centre = ctr[0];
    centre.x = ret[0];
    centre.y = ret[1];
    var rad = ret[2];
    var pts = this._getCirclePts(
      centre,
      rad,
      ctr[first],
      ctr[last % mctr.length],
      last - first - 1
    );

    for (let i = first + 1; i < last; i++) {
      var pt = pts[i];
      if (opType == DILATE) {
        if (
          this._distance(pt, ctrCen) >
          this._distance(mctr[i % mctr.length], ctrCen)
        ) {
          // console.log('5\n');
          mctr[i % mctr.length] = pt;
        }
      } else {
        if (
          this._distance(pt, ctrCen) <
          this._distance(mctr[i % mctr.length], ctrCen)
        ) {
          // console.log('6\n');
          mctr[i % mctr.length] = pt;
        }
      }
    }
    return;
  }

  _updateContour(cirCen, opType) {
    const { points, mousePoint, toolSize, element } = this._sculptData;
    // console.log('Trail\n');
    cirCen = mousePoint;
    this.opType = opType;
    this.ctr = points;
    var xsum = 0,
      ysum = 0;
    this.ctr.forEach((pt) => {
      xsum += pt.x;
      ysum += pt.y;
    });

    var ctrCen = this.ctr[0];
    ctrCen.x = xsum / this.ctr.length;
    ctrCen.y = ysum / this.ctr.length;

    var inside = this._circleInCtr(cirCen, this.ctr, ctrCen);

    if (
      !((inside && this.opType == DILATE) || (!inside && this.opType == ERODE))
    ) {
      return this.ctr; // the circle should be outside for erosion and inside for dilation
    }

    var first = -1,
      last = -1; // the first and last point on the contour that lie inside the circle
    var dilateD = 10000,
      erodeD = 0; // min and max distance from "cen", ie  cirCen or ctrCen, depending on opType

    var cen = this.opType == ERODE ? ctrCen : cirCen;
    var shift = 0;
    if (this._distance(this.ctr[0], cirCen) < this.radius) {
      // console.log('1\n');
      shift = this.ctr.length / 2.0; // this is to handle the case when the first ctr pt is inside the arc.
    } else {
      shift = 0;
    }

    /* this is to handle the case when the first ctr pt is inside the arc. In that caase
        the search will start from i+shift in the coming for loop. This is to make sure that 
         the first point is outside of the circle arc. 
    */

    for (let i = 0; i < this.ctr.length; i++) {
      var d = this._distance(this.ctr[(i + shift) % this.ctr.length], cirCen);
      // console.log('2\n');
      if (d < this.radius) {
        if (first == -1) first = i + shift;
        if (last == -1 || i - last + shift <= 2) last = i + shift;
      } // if the point is inside the circle
    }

    if (first >= this.ctr.length) {
      first = first % this.ctr.length;
      last = last % this.ctr.length;
    }

    if (first != -1) {
      this._adjustPt(this.ctr, cirCen, ctrCen, first, last, this.opType);
    }
    return this.ctr;
  }

  _dense() {
    var dists = [];
    var candidates = [];
    this.ctr.forEach((pt, i) => {
      var dist = 0;
      if (i != this.ctr.length - 1)
        dist = this._distance(this.ctr[i], this.ctr[i + 1]);
      else dist = this._distance(this.ctr[i], this.ctr[0]);
      dists.push(dist);
    });

    var cutoff = 10;
    var offset = 0;

    dists.forEach((d, i) => {
      var num = Math.floor(d / cutoff);
      var points = [];
      if (num !== 0) {
        if (i != dists.length - 1) {
          for (let f = 0; f < num; f++) {
            var temp =
              this.ctr[i + offset] +
              ((f + 1) / (num + 1)) *
                (this.ctr[i + 1 + offset] - this.ctr[i + offset]);
            points.push(temp);
          }
        } else {
          for (let f = 0; f < num; f++) {
            var temp =
              this.ctr[i + offset] +
              ((f + 1) / (num + 1)) * (this.ctr[0] - this.ctr[i + offset]);
            points.push(temp);
          }
        }
        points.map((pt) => [pt[0], pt[1]]);
        // points = [pt.reshape([-1, 2]) for pt in points];

        // points = np.concatenate(points, axis=0);

        this.ctr.splice(i + 1 + offset, 0, ...points);
        // s.ctr = np.insert(s.ctr, i + 1 + offset, points, axis=0);
        offset += points.shape[0];
      }
    });
    var tempEdited = [];
    for (let i = 0; i < this.ctr.length; i++) {
      tempEdited.push(0);
    }
    this.bPtsEdited = tempEdited; // to indicate if a boundary point has already been modified
    return [this.ctr, this.bPtsEdited];
  }

  /**
   * _pushHandles -Pushes the points radially away from the mouse if they are
   * contained within the circle defined by the delta nudge's toolSize and
   * the mouse position.
   *
   * @returns {Object}  The first and last pushedHandles.
   */
  _pushHandles() {
    const { points, mousePoint, toolSize, element } = this._sculptData;
    const pushedHandles = {};
    // console.log(points[0]);
    /* 
      Format of each point in points list
      FreehandHandleData {x: 965.2375000000001, y: 100.48250000000004, highlight: true, active: true, lines: Array(1)} 
   */
    for (let i = 0; i < points.length; i++) {
      // converts point on contour from pixel coords to canvas coords
      const pointsCanvas = external.cornerstone.pixelToCanvas(
        element,
        points[i]
      );

      //converts mouse pointer from pixel coords to canvas coords
      const mousePointCanvas = external.cornerstone.pixelToCanvas(
        element,
        mousePoint
      );
      //distance in canvas units
      const distanceToHandleCanvas = external.cornerstoneMath.point.distance(
        pointsCanvas,
        mousePointCanvas
      );

      //distance in pixel units
      const distanceToHandle = external.cornerstoneMath.point.distance(
        points[i],
        mousePoint
      );
      // console.log('Outside ', mousePoint);
      // console.log('Outside', distanceToHandleCanvas);
      // 52 represents the radius of outer circle in canvas units
      if (distanceToHandleCanvas > 52) {
        continue;
      }
      // console.log('Found', distanceToHandleCanvas);
      // console.log('Inside ', mousePoint);
      var currScale =
        external.cornerstone.getEnabledElement(element).viewport.scale;

      /*
        currScale = Stores the current viewport scale 
        prevScale = Stores the previous viewport scale
        testElement = Resultant - has corrent value of shift;
      */

      if (currScale !== prevScale) {
        prevScale = currScale;
        testElement = distanceToHandle;
      }

      this._pushOneHandle(i, distanceToHandle, testElement);
      if (pushedHandles.first === undefined) {
        pushedHandles.first = i;
        pushedHandles.last = i;
      } else {
        pushedHandles.last = i;
      }
    }

    return pushedHandles;
  }

  /**
   * Pushes one handle.
   *
   * @private
   * @param {number} i - The index of the handle to push.
   * @param {number} distanceToHandle - The distance between the mouse cursor and the handle.
   * @returns {void}
   */
  _pushOneHandle(i, distanceToHandle, testData) {
    const { points, mousePoint, toolSize, image } = this._sculptData;
    const handle = points[i];

    // const directionUnitVector = {
    //   x: (handle.x - mousePoint.x) / distanceToHandle,
    //   y: (handle.y - mousePoint.y) / distanceToHandle,
    // };
    // let tx = mousePoint.x + Math.ceil(testData) * directionUnitVector.x;
    // let ty = mousePoint.y + Math.ceil(testData) * directionUnitVector.y;

    // console.log(angle);
    // console.log('X ' + handle.x + ' --> ' + tx);
    // console.log('Y ' + handle.y + ' --> ' + ty);

    let tx = (2 / testData) * (handle.x - mousePoint.x) + handle.x;
    let ty = (2 / testData) * (handle.y - mousePoint.y) + handle.y;
    const position = {
      x: tx,
      y: ty,
    };

    // clipToBox(position, image);

    handle.x = position.x;
    handle.y = position.y;

    // Push lines
    const lastHandleIndex = this.constructor._getPreviousHandleIndex(
      i,
      points.length
    );

    points[lastHandleIndex].lines.pop();
    points[lastHandleIndex].lines.push(handle);
  }

  /**
   * Inserts additional handles in sparsely sampled regions of the contour. The
   * new handles are placed on the circle defined by the the deltaNudge's
   * toolSize and the mouse position.
   * @private
   * @param {Array} pushedHandles
   * @returns {void}
   */
  _insertNewHandles(pushedHandles) {
    const indiciesToInsertAfter = this._findNewHandleIndicies(pushedHandles);
    let newIndexModifier = 0;

    for (let i = 0; i < indiciesToInsertAfter.length; i++) {
      const insertIndex = indiciesToInsertAfter[i] + 1 + newIndexModifier;

      this._insertHandleRadially(insertIndex);
      newIndexModifier++;
    }
  }

  /**
   * Returns an array of indicies that describe where new handles should be
   * inserted (where the distance between subsequent handles is >
   * config.maxSpacing).
   *
   * @private
   * @param {Object} pushedHandles - The first and last handles that were pushed.
   * @returns {Object} An array of indicies that describe where new handles should be inserted.
   */
  _findNewHandleIndicies(pushedHandles) {
    const { points, maxSpacing } = this._sculptData;
    const indiciesToInsertAfter = [];

    for (let i = pushedHandles.first; i <= pushedHandles.last; i++) {
      this._checkSpacing(i, points, indiciesToInsertAfter, maxSpacing);
    }

    const pointAfterLast = this.constructor._getNextHandleIndex(
      pushedHandles.last,
      points.length
    );

    // Check points before and after those pushed.
    if (pointAfterLast !== pushedHandles.first) {
      this._checkSpacing(
        pointAfterLast,
        points,
        indiciesToInsertAfter,
        maxSpacing
      );

      const pointBeforeFirst = this.constructor._getPreviousHandleIndex(
        pushedHandles.first,
        points.length
      );

      if (pointBeforeFirst !== pointAfterLast) {
        this._checkSpacing(
          pointBeforeFirst,
          points,
          indiciesToInsertAfter,
          maxSpacing
        );
      }
    }

    return indiciesToInsertAfter;
  }

  /**
   * _checkSpacing - description
   *@modifies indiciesToInsertAfter
   *
   * @param {number} i - The index to check.
   * @param {Object} points - The points.
   * @param {Array} indiciesToInsertAfter - The working list of indicies to insert new points after.
   * @param {number} maxSpacing
   * @returns {void}
   */
  _checkSpacing(i, points, indiciesToInsertAfter, maxSpacing) {
    const nextHandleIndex = this.constructor._getNextHandleIndex(
      i,
      points.length
    );

    const distanceToNextHandle = external.cornerstoneMath.point.distance(
      points[i],
      points[nextHandleIndex]
    );

    if (distanceToNextHandle > maxSpacing) {
      indiciesToInsertAfter.push(i);
    }
  }

  /**
   * Inserts a handle on the surface of the circle defined by toolSize and the
   * mousePoint.
   *
   * @private
   * @param {number} insertIndex - The index to insert the new handle.
   * @returns {void}
   */
  _insertHandleRadially(insertIndex) {
    const { points } = this._sculptData;

    const previousIndex = insertIndex - 1;
    const nextIndex = this.constructor._getNextHandleIndexBeforeInsert(
      insertIndex,
      points.length
    );
    const insertPosition = this._getInsertPosition(
      insertIndex,
      previousIndex,
      nextIndex
    );
    const handleData = new FreehandHandleData(insertPosition);

    points.splice(insertIndex, 0, handleData);

    // Add the line from the previous handle to the inserted handle (note the tool is now one increment longer)
    points[previousIndex].lines.pop();
    points[previousIndex].lines.push(points[insertIndex]);

    freehandUtils.addLine(points, insertIndex);
  }

  /**
   * Checks for any close points and consolidates these to a
   * single point.
   *
   * @private
   * @returns {void}
   */
  _consolidateHandles() {
    const { points } = this._sculptData;

    // Don't merge handles if it would destroy the polygon.
    if (points.length <= 3) {
      return;
    }

    const closePairs = this._findCloseHandlePairs();

    this._mergeCloseHandles(closePairs);
  }

  /**
   * Finds pairs of close handles with seperations < config.minSpacing. No handle
   * is included in more than one pair, to avoid spurious deletion of densely
   * populated regions of the contour (see mergeCloseHandles).
   *
   * @private
   * @returns {Array} An array of close pairs in points.
   */
  _findCloseHandlePairs() {
    const { points, minSpacing } = this._sculptData;
    const closePairs = [];
    let length = points.length;

    for (let i = 0; i < length; i++) {
      const nextHandleIndex = this.constructor._getNextHandleIndex(
        i,
        points.length
      );

      const distanceToNextHandle = external.cornerstoneMath.point.distance(
        points[i],
        points[nextHandleIndex]
      );

      if (distanceToNextHandle < minSpacing) {
        const pair = [i, nextHandleIndex];

        closePairs.push(pair);

        // Don't check last node if first in pair to avoid double counting.
        if (i === 0) {
          length -= 1;
        }

        // Don't double count pairs in order to prevent your polygon collapsing to a singularity.
        i++;
      }
    }

    return closePairs;
  }

  /**
   * Merges points given a list of close pairs. The points are merged in an
   * iterative fashion to prevent generating a singularity in some edge cases.
   *
   * @private
   * @param {Array} closePairs - An array of pairs of handle indicies.
   * @returns {void}
   */
  _mergeCloseHandles(closePairs) {
    let removedIndexModifier = 0;

    for (let i = 0; i < closePairs.length; i++) {
      const pair = this.constructor._getCorrectedPair(
        closePairs[i],
        removedIndexModifier
      );

      this._combineHandles(pair);
      removedIndexModifier++;
    }

    // Recursively remove problem childs
    const newClosePairs = this._findCloseHandlePairs();

    if (newClosePairs.length) {
      this._mergeCloseHandles(newClosePairs);
    }
  }

  /**
   * Combines two handles defined by the indicies in handlePairs.
   *
   * @private
   * @param {Object} handlePair - A pair of handle indicies.
   * @returns {void}
   */
  _combineHandles(handlePair) {
    const { points, image } = this._sculptData;

    // Calculate combine position: half way between the handles.
    const midPoint = {
      x: (points[handlePair[0]].x + points[handlePair[1]].x) / 2.0,
      y: (points[handlePair[0]].y + points[handlePair[1]].y) / 2.0,
    };

    clipToBox(midPoint, image);

    // Move first point to midpoint
    points[handlePair[0]].x = midPoint.x;
    points[handlePair[0]].y = midPoint.y;

    // Link first point to handle that second point links to.
    const handleAfterPairIndex = this.constructor._getNextHandleIndex(
      handlePair[1],
      points.length
    );

    points[handlePair[0]].lines.pop();
    points[handlePair[0]].lines.push(points[handleAfterPairIndex]);

    // Remove the latter handle
    points.splice(handlePair[1], 1);
  }

  /**
   * Calculates the distance to the closest handle in the tool, and stores the
   * result in this._toolSizeImage and this._toolSizeCanvas.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */

  _configureToolSize(eventData) {
    const element = eventData.element;
    const config = this.configuration;
    const toolIndex = config.currentTool;
    const coords = eventData.currentPoints.image;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[toolIndex];

    const freehandRoiTool = getToolForElement(element, this.referencedToolName);

    let radiusCanvas = freehandRoiTool.distanceFromPointCanvas(
      element,
      data,
      coords
    );

    let radiusImage = 271;

    // var {
    //   distance,
    //   point: { x, y },
    // } = freehandRoiTool.distanceAndPointOnContour(element, data, coords);

    var scale = external.cornerstone.getEnabledElement(element).viewport.scale;
    // Check if should limit maximum size.
    if (config.limitRadiusOutsideRegion) {
      // radiusImage = this._limitCursorRadiusImage(eventData, radiusImage);
      radiusCanvas = this._limitCursorRadiusCanvas(eventData, radiusCanvas);
    }

    this._toolSizeImage = radiusImage;
    this._toolSizeCanvas = radiusCanvas;
  }

  /**
   * Gets the current mouse location and stores it in the configuration object.
   *
   * @private
   * @param {Object} eventData - The data assoicated with the event.
   * @returns {void}
   */
  _getMouseLocation(eventData) {
    const config = this.configuration;

    config.mouseLocation.handles.start.x = eventData.currentPoints.image.x;
    config.mouseLocation.handles.start.y = eventData.currentPoints.image.y;
    clipToBox(config.mouseLocation.handles.start, eventData.image);
  }

  /**
   * Attaches event listeners to the element such that is is visible, modifiable, and new data can be created.
   *
   * @private
   * @param {Object} element - The viewport element to attach event listeners to.
   * @modifies {element}
   * @returns {void}
   */
  _activateSculpt(element) {
    this._deactivateSculpt(element);

    // Begin activeMouseDragCallback loop - call activeMouseUpCallback at end of drag or straight away if just a click.
    element.addEventListener(EVENTS.MOUSE_UP, this.activeMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_CLICK, this.activeMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_DRAG, this.activeMouseDragCallback);

    element.addEventListener(EVENTS.TOUCH_END, this.activeTouchEndCallback);
    element.addEventListener(EVENTS.TOUCH_TAP, this.activeTouchEndCallback);
    element.addEventListener(EVENTS.TOUCH_DRAG, this.activeMouseDragCallback);

    external.cornerstone.updateImage(element);
  }

  /**
   * Removes event listeners from the element.
   *
   * @private
   * @param {Object} element - The viewport element to remove event listeners from.
   * @modifies {element}
   * @returns {void}
   */
  _deactivateSculpt(element) {
    element.removeEventListener(EVENTS.MOUSE_UP, this.activeMouseUpCallback);
    element.removeEventListener(EVENTS.MOUSE_CLICK, this.activeMouseUpCallback);
    element.removeEventListener(
      EVENTS.MOUSE_DRAG,
      this.activeMouseDragCallback
    );

    element.removeEventListener(EVENTS.TOUCH_END, this.activeTouchEndCallback);
    element.removeEventListener(EVENTS.TOUCH_TAP, this.activeTouchEndCallback);
    element.removeEventListener(
      EVENTS.TOUCH_DRAG,
      this.activeMouseDragCallback
    );

    external.cornerstone.updateImage(element);
  }

  /**
   * Invalidate the freehand tool data, tirggering re-calculation of statistics.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _invalidateToolData(eventData) {
    const config = this.configuration;
    const element = eventData.element;
    const toolData = getToolState(element, this.referencedToolName);
    const data = toolData.data[config.currentTool];

    data.invalidated = true;
  }

  /**
   * Deactivates all freehand ROIs and change currentTool to null
   *
   * @private
   * @param {Object} evt - The event.
   * @returns {void}
   */
  // eslint-disable-next-line no-unused-vars
  _deselectAllTools(evt) {
    const config = this.configuration;
    const toolData = getToolState(this.element, this.referencedToolName);

    config.currentTool = null;

    if (toolData) {
      for (let i = 0; i < toolData.data.length; i++) {
        toolData.data[i].active = false;
      }
    }

    setToolCursor(this.element, this.svgCursor);
    if (external.cornerstone.getImage(this.element)) {
      external.cornerstone.updateImage(this.element);
    }
  }

  /**
   * Given a pair of indicies, and the number of points already removed,
   * convert to the correct live indicies.
   *
   * @private
   * @static
   * @param {Object} pair A pairs of handle indicies.
   * @param {Number} removedIndexModifier The number of handles already removed.
   * @returns {Object} The corrected pair of handle indicies.
   */
  static _getCorrectedPair(pair, removedIndexModifier) {
    const correctedPair = [
      pair[0] - removedIndexModifier,
      pair[1] - removedIndexModifier,
    ];

    // Deal with edge case of last node + first node.
    if (correctedPair[1] < 0) {
      correctedPair[1] = 0;
    }

    return correctedPair;
  }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted (in canvas coordinates).
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radiusCanvas The distance from the mouse to the ROI
   *                                in canvas coordinates.
   * @returns {Number}              The limited radius in canvas coordinates.
   */
  _limitCursorRadiusCanvas(eventData, radiusCanvas) {
    return this._limitCursorRadius(eventData, radiusCanvas, true);
  }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted (in image coordinates).
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radiusImage  The distance from the mouse to the ROI
   *                                in image coordinates.
   * @returns {Number}              The limited radius in image coordinates.
   */
  // _limitCursorRadiusImage(eventData, radiusImage) {
  //   // return this._limitCursorRadius(eventData, radiusImage, false);
  //   return this._limitCursorRadius(eventData, radiusImage, false);
  // }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted.
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radius       The distance from the mouse to the ROI.
   * @param  {Boolean} canvasCoords Whether the calculation should be performed
   *                                In canvas coordinates.
   * @returns {Number}              The limited radius.
   */
  _limitCursorRadius(eventData, radius, canvasCoords = false) {
    // return radius;
    // if (canvasCoords) return 25;
    const element = eventData.element;
    const image = eventData.image;
    const config = this.configuration;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[config.currentTool];

    let areaModifier = 1.0;

    if (canvasCoords) {
      const topLeft = external.cornerstone.pixelToCanvas(element, {
        x: 0,
        y: 0,
      });
      const bottomRight = external.cornerstone.pixelToCanvas(element, {
        x: image.width,
        y: image.height,
      });
      const canvasArea =
        (bottomRight.x - topLeft.x) * (bottomRight.y - topLeft.y);

      areaModifier = canvasArea / (image.width * image.height);
    }

    const area = data.area * areaModifier;
    const maxRadius = Math.pow(area / Math.PI, 0.5);

    return Math.min(radius, maxRadius);
  }

  /**
   * Finds the nearest handle to the mouse cursor for all freehand
   * data on the element.
   *
   * @private
   * @param {Object} element - The element.
   * @param {Object} eventData - Data object associated with the event.
   * @returns {Number} The tool index of the closest freehand tool.
   */
  _getClosestFreehandToolOnElement(element, eventData) {
    const freehand = getToolForElement(element, this.referencedToolName);
    const toolState = getToolState(element, this.referencedToolName);

    if (!toolState) {
      return;
    }

    const data = toolState.data;
    const pixelCoords = eventData.currentPoints.image;

    const closest = {
      distance: Infinity,
      toolIndex: null,
    };

    for (let i = 0; i < data.length; i++) {
      const distanceFromToolI = freehand.distanceFromPoint(
        element,
        data[i],
        pixelCoords
      );

      if (distanceFromToolI === -1) {
        continue;
      }

      if (distanceFromToolI < closest.distance) {
        closest.distance = distanceFromToolI;
        closest.toolIndex = i;
      }
    }

    return closest.toolIndex;
  }

  /**
   * Returns the next handle index.
   *
   * @private
   * @static
   * @param {Number} i - The handle index.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The next handle index.
   */
  static _getNextHandleIndex(i, length) {
    if (i === length - 1) {
      return 0;
    }

    return i + 1;
  }

  /**
   * Returns the previous handle index.
   *
   * @private
   * @static
   * @param {Number} i - The handle index.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The previous handle index.
   */
  static _getPreviousHandleIndex(i, length) {
    if (i === 0) {
      return length - 1;
    }

    return i - 1;
  }

  /**
   * Returns the next handle index, with a correction considering a handle is
   * about to be inserted.
   *
   * @private
   * @static
   * @param {Number} insertIndex - The index in which the handle is being inserted.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The next handle index.
   */
  static _getNextHandleIndexBeforeInsert(insertIndex, length) {
    if (insertIndex === length) {
      return 0;
    }
    // Index correction here: The line bellow is correct, as we haven't inserted our handle yet!

    return insertIndex;
  }

  /**
   * Calculates the position that a new handle should be inserted.
   *
   * @private
   * @static
   * @param {Number} insertIndex - The index to insert the new handle.
   * @param {Number} previousIndex - The previous index.
   * @param {Number} nextIndex - The next index.
   * @returns {Object} The position the handle should be inserted.
   */
  _getInsertPosition(insertIndex, previousIndex, nextIndex) {
    const { points, toolSize, mousePoint, image, element } = this._sculptData;

    const midPoint = {
      x: (points[previousIndex].x + points[nextIndex].x) / 2.0,
      y: (points[previousIndex].y + points[nextIndex].y) / 2.0,
    };

    const distanceToMidPoint = external.cornerstoneMath.point.distance(
      mousePoint,
      midPoint
    );

    const mousePointCanvas = external.cornerstone.pixelToCanvas(
      element,
      mousePoint
    );

    const midPointCanvas = external.cornerstone.pixelToCanvas(
      element,
      midPoint
    );

    const distanceToMidPointCanvas = external.cornerstoneMath.point.distance(
      mousePointCanvas,
      midPointCanvas
    );

    let insertPosition;

    if (distanceToMidPointCanvas < 52) {
      const directionUnitVector = {
        x: (midPoint.x - mousePoint.x) / distanceToMidPoint,
        y: (midPoint.y - mousePoint.y) / distanceToMidPoint,
      };
      insertPosition = {
        x: mousePoint.x + 271 * directionUnitVector.x,
        y: mousePoint.y + 271 * directionUnitVector.y,
      };
    } else {
      insertPosition = midPoint;
    }

    clipToBox(insertPosition, image);

    return insertPosition;
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  get minSpacing() {
    return this.configuration.minSpacing;
  }

  set minSpacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set DeltaNudge minSpacing to a value other than a number.'
      );
    }

    this.configuration.minSpacing = value;
  }

  get maxSpacing() {
    return this.configuration.maxSpacing;
  }

  set maxSpacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set DeltaNudge maxSpacing to a value other than a number.'
      );
    }

    this.configuration.maxSpacing = value;
  }

  get showCursorOnHover() {
    return this.configuration.showCursorOnHover;
  }

  set showCursorOnHover(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set deltaNudge showCursorOnHover to a value other than a boolean.'
      );
    }

    this.configuration.showCursorOnHover = value;
    external.cornerstone.updateImage(this.element);
  }

  get limitRadiusOutsideRegion() {
    return this.configuration.limitRadiusOutsideRegion;
  }

  set limitRadiusOutsideRegion(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set deltaNudge limitRadiusOutsideRegion to a value other than a boolean.'
      );
    }

    this.configuration.limitRadiusOutsideRegion = value;
    external.cornerstone.updateImage(this.element);
  }

  get hoverCursorFadeAlpha() {
    return this.configuration.hoverCursorFadeAlpha;
  }

  set hoverCursorFadeAlpha(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set deltaNudge hoverCursorFadeAlpha to a value other than a number.'
      );
    }

    // Clamp the value from 0 to 1.
    value = Math.max(Math.min(value, 1.0), 0.0);

    this.configuration.hoverCursorFadeAlpha = value;
    external.cornerstone.updateImage(this.element);
  }

  get hoverCursorFadeDistance() {
    return this.configuration.hoverCursorFadeDistance;
  }

  set hoverCursorFadeDistance(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set dektaNudge hoverCursorFadeDistance to a value other than a number.'
      );
    }

    // Don't allow to fade a distances smaller than the tool's radius.
    value = Math.max(value, 1.0);

    this.configuration.hoverCursorFadeDistance = value;
    external.cornerstone.updateImage(this.element);
  }
}

/**
 * Returns the default DeltaNudgeToolconfiguration.
 *
 * @returns {Object} The default configuration object.
 */
function getDefaultDeltaNudgeToolConfiguration() {
  return {
    mouseLocation: {
      handles: {
        start: {
          highlight: true,
          active: true,
        },
      },
    },
    minSpacing: 1,
    currentTool: null,
    dragColor: toolColors.getActiveColor(),
    hoverColor: toolColors.getToolColor(),

    /* --- Hover options ---
    showCursorOnHover:        Shows a preview of the sculpting radius on hover.
    limitRadiusOutsideRegion: Limit max toolsize outside the subject ROI based
                              on subject ROI area.
    hoverCursorFadeAlpha:     Alpha to fade to when tool very distant from
                              subject ROI.
    hoverCursorFadeDistance:  Distance from ROI in which to fade the hoverCursor
                              (in units of radii).
    */
    showCursorOnHover: true,
    limitRadiusOutsideRegion: true,
    hoverCursorFadeAlpha: 0.5,
    hoverCursorFadeDistance: 1.2,
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}

// radiusImage - controls radius of contour change
// radiusConvas - controls radius of the circles
