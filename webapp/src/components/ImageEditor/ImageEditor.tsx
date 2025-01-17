import * as React from 'react';

import { Provider } from 'react-redux';
import store from './store/imageStore'
import { SideBar } from './SideBar';
import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { ImageCanvas } from './ImageCanvas';

import { Timeline } from './Timeline';
import { addKeyListener, removeKeyListener } from './keyboardShortcuts';

import { dispatchSetInitialState, dispatchImageEdit, dispatchChangeZoom, dispatchSetInitialFrames } from './actions/dispatch';
import { Bitmap, bitmapToImageLiteral } from './store/bitmap';
import { EditorState, AnimationState } from './store/imageReducer';
import { imageStateToBitmap } from './util';

export interface ImageEditorSaveState {
    editor: EditorState;
    past: AnimationState[];
}

export interface ImageEditorProps {
    singleFrame?: boolean;
}

export class ImageEditor extends React.Component<ImageEditorProps,{}> {
    componentDidMount() {
        addKeyListener();
    }

    componentWillUnmount() {
        removeKeyListener();
    }

    render() {
        const { singleFrame } = this.props;

        return <Provider store={store}>
            <div className="image-editor">
                <TopBar singleFrame={singleFrame} />
                <div className="image-editor-content">
                    <SideBar />
                    <ImageCanvas />
                    {singleFrame ? undefined : <Timeline />}
                </div>
                <BottomBar singleFrame={singleFrame} />
            </div>
        </Provider>
    }

    initSingleFrame(value: Bitmap) {
        store.dispatch(dispatchSetInitialFrames([{ bitmap: value.data() }], 100));
    }

    initAnimation(frames: Bitmap[], interval: number) {
        store.dispatch(dispatchSetInitialFrames(frames.map(frame => ({ bitmap: frame.data() })), interval));
    }

    onResize() {
        store.dispatch(dispatchChangeZoom(0));
    }

    getCurrentFrame() {
        const state = store.getState();
        const currentFrame = state.present.frames[state.present.currentFrame];

        return bitmapToImageLiteral(imageStateToBitmap(currentFrame), "ts");
    }

    getAllFrames() {
        const state = store.getState();
        return "[" + state.present.frames.map(frame => bitmapToImageLiteral(imageStateToBitmap(frame), "ts")).join(",") + "]";
    }

    getInterval() {
        return store.getState().present.interval;
    }

    getPersistentData(): ImageEditorSaveState {
        const state = store.getState();
        return {
            editor: state.editor,
            past: state.past
        }
    }

    restorePersistentData(oldValue: ImageEditorSaveState) {
        if (oldValue) {
            store.dispatch(dispatchSetInitialState(oldValue.editor, oldValue.past));
        }
    }

    setCurrentFrame(bitmap: Bitmap) {
        store.dispatch(dispatchImageEdit({ bitmap: bitmap.data() }))
    }
}