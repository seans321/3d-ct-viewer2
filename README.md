# 3D CT Volume Viewer

A WebGL-based 3D volume renderer for viewing CT scan data directly in the browser. This application allows users to load DICOM files and visualize them as interactive 3D volumes.

## Features

- **Browser-based DICOM parsing**: Parses DICOM files directly in the browser without server-side processing
- **3D Volume Rendering**: Uses WebGL ray casting for high-performance 3D visualization
- **Interactive Controls**: Rotate, zoom, and adjust visualization parameters
- **Adjustable Parameters**: Window level/width, threshold, and opacity controls
- **Real-time Rendering**: Smooth 3D visualization with mouse interaction

## Technical Details

- **DICOM Parsing**: Robust parser that handles various DICOM formats and metadata
- **WebGL Ray Casting**: Advanced rendering technique for realistic 3D visualization
- **Volume Texture Storage**: Efficient packing of multiple DICOM slices into 2D textures
- **Performance Optimized**: Designed for smooth rendering of large medical datasets

## Usage

1. Open the application in a modern browser
2. Click "Load DICOM Folder" and select a folder containing CT slice DICOM files
3. Use mouse to rotate the 3D volume (drag to rotate, scroll to zoom)
4. Adjust parameters using the sliders:
   - Threshold: Controls which voxels are displayed
   - Opacity: Controls transparency of structures
   - Window Level: Controls brightness
   - Window Width: Controls contrast

## Requirements

- Modern browser with WebGL support
- DICOM files containing CT scan data

## License

MIT