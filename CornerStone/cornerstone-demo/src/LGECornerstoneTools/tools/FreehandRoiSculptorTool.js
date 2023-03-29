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
import { freehandRoiSculptorCursor } from './cursors/index.js';
import { useState, useEffect } from 'react';
import freehandUtils from '../util/freehand/index.js';

const { FreehandHandleData } = freehandUtils;

/**
 * @public
 * @class FreehandRoiSculptorTool
 * @memberof Tools
 *
 * @classdesc Tool for easily sculpting annotations drawn with
 * the FreehandRoiTool.
 * @extends Tools.Base.BaseTool
 */
export default class FreehandRoiSculptorTool extends BaseTool {
  constructor(props = {}) {
    const defaultProps = {
      name: 'FreehandRoiSculptor',
      referencedToolName: 'FreehandRoi',
      supportedInteractionTypes: ['Mouse', 'Touch', 'DoubleTap'],
      mixins: ['activeOrDisabledBinaryTool'],
      configuration: getDefaultFreehandRoiSculptorToolConfiguration(),
      svgCursor: freehandRoiSculptorCursor,
    };

    super(props, defaultProps);

    this.updateOnMouseMove = true;
    this.isMultiPartTool = true;
    this.referencedToolName = this.initialConfiguration.referencedToolName;

    this._active = false;
    this.innerToolRadius = 10;
    this.outerToolRadius = 20;
    this.activateAnotherTool = false;
    this.pixelSize = 0.1;
    this.lastIndexPoint = null;
    this.checkOnceEdited = 0;
    this.outerCircleEditedPoints = {};
    this.innerCircleEditedPoints = {};

    // Create bound functions for private event loop.
    this.activeMouseUpCallback = this.activeMouseUpCallback.bind(this);
    this.activeTouchEndCallback = this.activeTouchEndCallback.bind(this);
    this.activeMouseDragCallback = this.activeMouseDragCallback.bind(this);
    this.activeKeyPress = this.activeKeyPress.bind(this);
  }

  renderToolData(evt) {
    // console.log('Called again');
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
      const options1 = {
        color: this.configuration.dragColor,
        fill: null,
        handleRadius: this._toolInnerSizeCanvas / scale,
        name: 'FreehandSculptorTool',
      };
      const options2 = {
        color: this.configuration.dragColor,
        fill: null,
        handleRadius: this._toolOuterSizeCanvas / scale,
        name: 'FreehandSculptorTool',
      };
      if (sessionStorage.getItem('tool_mode') == 'edit')
        drawHandles(
          context,
          eventData,
          this.configuration.mouseLocation.handles,
          options1
        );
      if (sessionStorage.getItem('tool_mode') == 'edit')
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
    console.log('activeMouseDragCallback - called on mouse drag');
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
    // console.log(eventData);
    this._sculpt(eventData, points, false);

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
    console.log('activeMouseUpCallback - called on mouse click and up');

    // Added to send contour on mouse click
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
    // console.log(eventData);

    // Adding extra paramater to check if being called on mouse click
    this._sculpt(eventData, points, true);

    // Update the image
    external.cornerstone.updateImage(eventData.element);

    // Till above line new code is added
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
    this.outerCircleEditedPoints = {};
    this.innerCircleEditedPoints = {};

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
    let radiusCanvas = freehandRoiTool.distanceFromPointCanvasForDeltaNudge(
      element,
      data,
      coords,
      10
    );

    this.configuration.mouseLocation.handles.start.x = coords.x;
    this.configuration.mouseLocation.handles.start.y = coords.y;

    // if (this.configuration.limitRadiusOutsideRegion) {
    //   const unlimitedRadius = this.outerToolRadius;

    //   this.outerToolRadius = this._limitCursorRadiusCanvas(eventData, this.outerToolRadius);

    //   // Fade if distant
    //   if (
    //     unlimitedRadius >
    //     this.configuration.hoverCursorFadeDistance * this.outerToolRadius
    //   ) {
    //     context.globalAlpha = this.configuration.hoverCursorFadeAlpha;
    //   }
    // }
    let innerRadiusCanvas =
      freehandRoiTool.distanceFromPointCanvasForDeltaNudge(
        element,
        data,
        coords,
        this.innerToolRadius
      );

    let outerRadiusCanvas =
      freehandRoiTool.distanceFromPointCanvasForDeltaNudge(
        element,
        data,
        coords,
        this.outerToolRadius
      );
    this.checkOnceEdited = 0;
    var scale = external.cornerstone.getEnabledElement(element).viewport.scale;
    const options1 = {
      fill: null,
      color: this.configuration.hoverColor,
      handleRadius: innerRadiusCanvas / scale,
      name: 'FreehandSculptorTool',
    };

    const options2 = {
      fill: null,
      color: this.configuration.hoverColor,
      handleRadius: outerRadiusCanvas / scale,
      name: 'FreehandSculptorTool',
    };
    if (sessionStorage.getItem('tool_mode') == 'edit')
      drawHandles(
        context,
        eventData,
        this.configuration.mouseLocation.handles,
        options1
      );
    if (sessionStorage.getItem('tool_mode') == 'edit')
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

  /**
   * Sculpts the freehand ROI with the circular freehandSculpter tool, moving,
   * adding and removing handles as necessary.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @param {Object} points - Array of points.
   * @returns {void}
   */
  _sculpt(eventData, points, clicked) {
    document.addEventListener('keydown', function (event) {
      if (event.code == 'KeyS' || event.key == 's' || event.key == 'S') {
        // console.log('Snap mode has been activated');
        sessionStorage.setItem('tool_mode', 'snap');
      }
      if (event.code == 'KeyE' || event.key == 'e' || event.key == 'E') {
        // console.log('Edit mode has been activatesd');
        sessionStorage.setItem('tool_mode', 'edit');
      }
    });
    const config = this.configuration;
    let defaultToolSize = null;
    if (this.activateAnotherTool == true) {
      defaultToolSize = this.innerToolRadius;
    } else {
      defaultToolSize = this.outerToolRadius;
    }
    this._sculptData = {
      element: eventData.element,
      image: eventData.image,
      mousePoint: eventData.currentPoints.image,
      points,
      toolSize: defaultToolSize,
      minSpacing: config.minSpacing,
      maxSpacing: Math.max(this.innerToolRadius, config.minSpacing * 2),
    };
    // console.log('Wihtout mouse click.\n');

    // Push existing handles radially away from tool.
    // if (this.checkOnceEdited == 0) {
    const pushedHandles = this._pushHandles(clicked);
    // Insert new handles in sparsely populated areas of the
    // Pushed part of the contour.
    // console.log('pushedHandles.first', pushedHandles.first);
    if (pushedHandles.first !== undefined) {
      this._insertNewHandles(pushedHandles);
      // If any handles have been pushed very close together or even overlap,
      // Combine these into a single handle.
      this._consolidateHandles();
    }

    // }
  }

  // sends HTTP request to specifies URL
  _sendHttpRequest(method, url, data) {
    const promise = new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.responseType = 'json';

      if (data) {
        xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.onload = () => {
        if (xhr.status >= 400) {
          reject(xhr.response);
        } else {
          resolve(xhr.response);
        }
      };
      xhr.onerror = () => {
        reject('Something went wrong');
      };
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
      xhr.send(JSON.stringify(data));
    });
    return promise;
  }

  // sends data to specified URL
  _sendData(url, data) {
    this._sendHttpRequest('POST', url, JSON.stringify(data))
      .then((responseData) => {
        console.log('Response from server : ' + responseData);
      })
      .catch((err) => {
        console.log(err);
      });
  }

  // gets data from specified URL
  _getData(url) {
    this._sendHttpRequest('GET', url).then((responseData) => {
      console.log(responseData);
    });
  }

  /**
   * _pushHandles -Pushes the points radially away from the mouse if they are
   * contained within the circle defined by the freehandSculpter's toolSize and
   * the mouse position.
   *
   * @returns {Object}  The first and last pushedHandles.
   */
  _pushHandles(clicked) {
    const { points, mousePoint, toolSize } = this._sculptData;
    console.log(this._sculptData);

    /* Getting data from API
            this._getData('http://127.0.0.1:5000/getNewContour');
    */
    const pushedHandles = {};
    const dummyPushHandles = [];
    let index = 0;
    if (
      external.cornerstoneMath.point.distance(points[0], mousePoint) <= toolSize
    ) {
      index = Math.floor(points.length / 2);
    }
    let count = 0;
    while (count < points.length) {
      let i = index;
      const distanceToHandle = external.cornerstoneMath.point.distance(
        points[i],
        mousePoint
      );
      index = (index + 1) % points.length;
      count++;
      if (distanceToHandle > toolSize) {
        continue;
      }
      if (pushedHandles.first === undefined) {
        pushedHandles.first = i;
        pushedHandles.last = i;
        dummyPushHandles.push(i);
      } else {
        pushedHandles.last = i;
        dummyPushHandles.push(i);
      }
    }
    this.activateAnotherTool = false;
    const xCordinate = points.reduce((acc, point) => {
      return acc + point.x / points.length;
    }, 0);
    const yCordinate = points.reduce((acc, point) => {
      return acc + point.y / points.length;
    }, 0);
    const centreContourPoint = {
      x: xCordinate,
      y: yCordinate,
    };

    let maximumDistance = 0;
    let idx = 0;
    if (pushedHandles.first > pushedHandles.last) {
      idx =
        (Math.floor(
          (points.length - pushedHandles.first + pushedHandles.last) / 2
        ) +
          pushedHandles.first) %
        points.length;
    } else {
      idx =
        Math.floor((pushedHandles.first + pushedHandles.last) / 2) %
        points.length;
    }

    if (Math.abs(pushedHandles.first - pushedHandles.last) >= 3) {
      if (
        points[idx]?.x &&
        points[idx]?.y &&
        centreContourPoint?.x &&
        centreContourPoint?.y
      ) {
        let contourPoint = [centreContourPoint.x, centreContourPoint.y];
        let centrePoint = [points[idx].x, points[idx].y];
        this.lastIndexPoint = centrePoint;
        let mouseCordinate = [mousePoint.x, mousePoint.y];
        let firstPointAndInnerCicleDis = this._distance(
          mouseCordinate,
          centrePoint
        );
        let innerpixel = 0;
        if (firstPointAndInnerCicleDis < this.innerToolRadius) {
          this.activateAnotherTool = true;
          // console.log('Entering inner circle\n');
          // document.addEventListener('click', function (event) {
          //   console.log(event.type);
          // });
        } else {
          this.activateAnotherTool = false;
        }
        let centreToMousePoint = this._distance(mouseCordinate, contourPoint);
        let centreToIndex = (maximumDistance =
          external.cornerstoneMath.point.distance(
            points[idx],
            centreContourPoint
          ));
        let opType = 0;
        if (centreToMousePoint > centreToIndex) {
          opType = -1;
        } else {
          opType = 1;
        }
        var delChange = opType * this.pixelSize + innerpixel;
        maximumDistance = centreToIndex + delChange;
        let idxCentre = this._findDir(contourPoint, centrePoint);
        let midPoint = this._getPoint(idxCentre, maximumDistance, contourPoint);
        var firstPoint = [
          points[pushedHandles.first].x,
          points[pushedHandles.first].y,
        ];
        var lastPoint = [
          points[pushedHandles.last].x,
          points[pushedHandles.last].y,
        ];
        let numPoints = Math.abs(pushedHandles.last - pushedHandles.first - 1);

        if (pushedHandles.first > pushedHandles.last) {
          let temp = firstPoint;
          firstPoint = lastPoint;
          lastPoint = temp;
          numPoints = Math.abs(
            points.length - pushedHandles.first + pushedHandles.last - 1
          );
          //  console.log("You are inside the exchange of points");
        }
        // console.log(
        //   'PushHandle points are',
        //   pushedHandles.first,
        //   pushedHandles.last
        // );

        /* Sending just the first and last index API

              this._sendData('http://127.0.0.1:5000/sendContour', pushedHandles);
        */

        /* Sending open contour points to API
              var openContour = [];
              for (let i = pushedHandles.first; i <= pushedHandles.last; i++) {
                openContour.push([points[i].x, points[i].x]);
              }
              this._sendData('http://127.0.0.1:5000/sendContour', openContour);
        */

        if (
          this.activateAnotherTool &&
          sessionStorage.getItem('tool_mode') == 'snap' &&
          clicked
        ) {
          var contourCenter = [centreContourPoint.x, centreContourPoint.y];
          var dir1 = this._findDir(contourCenter, firstPoint);
          var dir2 = this._findDir(contourCenter, lastPoint);
          console.log('Send the angles (th1 & th2) from here');
          console.log(dir1 + ' --- ' + dir2);
        }
        var ret = this._findCircle(firstPoint, midPoint, lastPoint);

        var centre = [ret[0], ret[1]];
        var rad = ret[2];
        // console.log(
        //   'First point and last',
        //   firstPoint + '  ' + numPoints + '  ' + lastPoint
        // );
        var pts = this._getCirclePts(
          centre,
          rad,
          firstPoint,
          lastPoint,
          numPoints
        );

        //  console.log("points length",points.length)
        //   console.log("Points after pushing",pts)
        var returnedIndex = 0;
        // console.log('outerCircleEditedPoints', this.outerCircleEditedPoints);
        // console.log('ineerCircleEditedPoints', this.innerCircleEditedPoints);
        if (pushedHandles.first > pushedHandles.last) {
          pts.reverse();
          let terminatingArray = points.length + pushedHandles.last - 1;
          this.checkOnceEdited += 1;
          for (let i = pushedHandles.first + 1; i < terminatingArray; i++) {
            // console.log('original points are', points[i % points.length]);
            let updatedDistance = this._distance(
              pts[returnedIndex],
              contourPoint
            );
            let initialDistance = external.cornerstoneMath.point.distance(
              points[i % points.length],
              centreContourPoint
            );
            if (this.activateAnotherTool == false) {
              if (this.outerCircleEditedPoints[i % points.length] == true) {
                returnedIndex++;
                continue;
              }
              if (
                opType == '1' &&
                pts[returnedIndex] &&
                updatedDistance > initialDistance
              ) {
                this.outerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
              if (
                opType == '-1' &&
                pts[returnedIndex] &&
                updatedDistance < initialDistance
              ) {
                this.outerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
            } else {
              if (this.innerCircleEditedPoints[i % points.length] == true) {
                returnedIndex++;
                continue;
              }
              if (
                opType == '1' &&
                pts[returnedIndex] &&
                updatedDistance > initialDistance
              ) {
                this.innerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
              if (
                opType == '-1' &&
                pts[returnedIndex] &&
                updatedDistance < initialDistance
              ) {
                this.innerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
            }
            returnedIndex++;
          }
          this.checkOnceEdited = 0;
        } else {
          this.checkOnceEdited += 1;
          for (
            let i = pushedHandles.first + 1;
            i < pushedHandles.last - 1;
            i++
          ) {
            let updatedDistance = this._distance(
              pts[returnedIndex],
              contourPoint
            );
            let initialDistance = external.cornerstoneMath.point.distance(
              points[i],
              centreContourPoint
            );
            if (this.activateAnotherTool == false) {
              if (this.outerCircleEditedPoints[i % points.length] == true) {
                returnedIndex++;
                continue;
              }
              if (
                opType == '1' &&
                pts[returnedIndex] &&
                updatedDistance > initialDistance
              ) {
                this.outerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
              if (
                opType == '-1' &&
                pts[returnedIndex] &&
                updatedDistance < initialDistance
              ) {
                this.outerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
            } else {
              if (this.innerCircleEditedPoints[i % points.length] == true) {
                returnedIndex++;
                continue;
              }
              if (
                opType == '1' &&
                pts[returnedIndex] &&
                updatedDistance > initialDistance
              ) {
                this.innerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
              if (
                opType == '-1' &&
                pts[returnedIndex] &&
                updatedDistance < initialDistance
              ) {
                this.innerCircleEditedPoints[i % points.length] = true;
                this._pushOneHandle(i % points.length, pts[returnedIndex]);
              }
            }
            returnedIndex++;
          }
          this.checkOnceEdited = 0;
        }
      }
    }

    return pushedHandles;
  }

  _findDir(pt1, pt2) {
    var th = Math.atan2(pt2[1] - pt1[1], pt2[0] - pt1[0]);
    th = (th * 180) / Math.PI;
    th = (360 + th) % 360;
    return th;
  }
  _getPoint(dir, len, cen) {
    var ptDir = (dir * Math.PI) / 180.0;
    var relPt = [len * Math.cos(ptDir), len * Math.sin(ptDir)];
    return [cen[0] + relPt[0], cen[1] + relPt[1]];
  }

  _distance(p1, p2) {
    return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
  }

  _findCircle(p1, p2, p3) {
    var x1 = p1[0],
      y1 = p1[1],
      x2 = p2[0],
      y2 = p2[1],
      x3 = p3[0],
      y3 = p3[1];

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
    var h = -g;
    var k = -f;
    var sqr_of_r = h * h + k * k - c;
    var r = Math.round(Math.sqrt(sqr_of_r), 5);
    return [h, k, r];
  }

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

  /**
   * Pushes one handle.
   *
   * @private
   * @param {number} i - The index of the handle to push.
   * @param {number} distanceToHandle - The distance between the mouse cursor and the handle.
   * @returns {void}
   */
  _pushOneHandle(i, point) {
    const { points, image } = this._sculptData;
    const handle = points[i];
    const position = {
      x: point[0],
      y: point[1],
    };

    clipToBox(position, image);

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
   * new handles are placed on the circle defined by the the freehandSculpter's
   * toolSize and the mouse position.
   * @private
   * @param {Array} pushedHandles
   * @returns {void}
   */
  _insertNewHandles(pushedHandles) {
    const indiciesToInsertAfter = this._findNewHandleIndicies(pushedHandles);
    let newIndexModifier = 0;
    // console.log('new insert points', indiciesToInsertAfter.length);
    for (let i = 0; i < indiciesToInsertAfter.length; i++) {
      const insertIndex = indiciesToInsertAfter[i] + 1 + newIndexModifier;

      this._insertHandleRadially(insertIndex);
      // console.log('new insert points');
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
    let defaultToolSize = null;
    if (this.activateAnotherTool == true) {
      defaultToolSize = this.innerToolRadius;
    } else {
      defaultToolSize = this.outerToolRadius;
    }
    const element = eventData.element;
    const config = this.configuration;
    const toolIndex = config.currentTool;
    const coords = eventData.currentPoints.image;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[toolIndex];

    const freehandRoiTool = getToolForElement(element, this.referencedToolName);

    let radiusImage = defaultToolSize;
    let innerRadiusCanvas =
      freehandRoiTool.distanceFromPointCanvasForDeltaNudge(
        element,
        data,
        coords,
        this.innerToolRadius
      );

    let outerRadiusCanvas =
      freehandRoiTool.distanceFromPointCanvasForDeltaNudge(
        element,
        data,
        coords,
        this.outerToolRadius
      );

    // Check if should limit maximum size.
    // if (config.limitRadiusOutsideRegion) {
    //   radiusImage = this._limitCursorRadiusImage(eventData, radiusImage);
    //   radiusCanvas = this._limitCursorRadiusCanvas(eventData, radiusCanvas);
    // }

    this._toolSizeImage = radiusImage;
    this._toolInnerSizeCanvas = innerRadiusCanvas;
    this._toolOuterSizeCanvas = outerRadiusCanvas;
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
    console.log('_activateSculpt - called at every right mouse click');
    // Begin activeMouseDragCallback loop - call activeMouseUpCallback at end of drag or straight away if just a click.
    element.addEventListener(EVENTS.MOUSE_UP, this.activeMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_CLICK, this.activeMouseUpCallback);
    document.documentElement.addEventListener('keydown', this.activeKeyPress);
    element.addEventListener(EVENTS.MOUSE_DRAG, this.activeMouseDragCallback);

    element.addEventListener(EVENTS.TOUCH_END, this.activeTouchEndCallback);
    element.addEventListener(EVENTS.TOUCH_TAP, this.activeTouchEndCallback);
    element.addEventListener(EVENTS.TOUCH_DRAG, this.activeMouseDragCallback);

    external.cornerstone.updateImage(element);
  }

  activeKeyPress(evt) {
    if (evt.key == 'ArrowUp') {
      this.innerToolRadius = this.innerToolRadius + this.innerToolRadius * 0.1;
      this.outerToolRadius = this.outerToolRadius + this.outerToolRadius * 0.1;
    } else if (evt.key == 'ArrowDown') {
      this.innerToolRadius = this.innerToolRadius - this.innerToolRadius * 0.1;
      this.outerToolRadius = this.outerToolRadius - this.outerToolRadius * 0.1;
    } else if (evt.key == 'ArrowRight') {
      if (this.pixelSize > 1) return;
      this.pixelSize = this.pixelSize + 0.1;
    } else if (evt.key == 'ArrowLeft') {
      if (this.pixelSize < 0.1) return;
      this.pixelSize = this.pixelSize - 0.1;
    }
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
    // document.documentElement.removeEventListener('keydown',this.activeKeyPress)

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
  _limitCursorRadiusImage(eventData, radiusImage) {
    return this._limitCursorRadius(eventData, radiusImage, false);
  }

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
    const { points, toolSize, mousePoint, image } = this._sculptData;

    // Calculate insert position: half way between the handles, then pushed out
    // Radially to the edge of the freehandSculpter.
    const midPoint = {
      x: (points[previousIndex].x + points[nextIndex].x) / 2.0,
      y: (points[previousIndex].y + points[nextIndex].y) / 2.0,
    };

    const distanceToMidPoint = external.cornerstoneMath.point.distance(
      mousePoint,
      midPoint
    );

    let insertPosition;

    if (distanceToMidPoint < toolSize) {
      const directionUnitVector = {
        x: (midPoint.x - mousePoint.x) / distanceToMidPoint,
        y: (midPoint.y - mousePoint.y) / distanceToMidPoint,
      };

      insertPosition = {
        x: mousePoint.x + toolSize * directionUnitVector.x,
        y: mousePoint.y + toolSize * directionUnitVector.y,
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
        'Attempting to set freehandSculpter minSpacing to a value other than a number.'
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
        'Attempting to set freehandSculpter maxSpacing to a value other than a number.'
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
        'Attempting to set freehandSculpter showCursorOnHover to a value other than a boolean.'
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
        'Attempting to set freehandSculpter limitRadiusOutsideRegion to a value other than a boolean.'
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
        'Attempting to set freehandSculpter hoverCursorFadeAlpha to a value other than a number.'
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
        'Attempting to set freehandSculpter hoverCursorFadeDistance to a value other than a number.'
      );
    }

    // Don't allow to fade a distances smaller than the tool's radius.
    value = Math.max(value, 1.0);

    this.configuration.hoverCursorFadeDistance = value;
    external.cornerstone.updateImage(this.element);
  }
}

/**
 * Returns the default freehandRoiSculptorTool configuration.
 *
 * @returns {Object} The default configuration object.
 */
function getDefaultFreehandRoiSculptorToolConfiguration() {
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
