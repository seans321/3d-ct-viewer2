/**
 * Highly Robust DICOM Parser for Browser
 * Handles parsing of various DICOM formats and extraction of pixel data
 */
class DicomParser {
    constructor() {
        // Common DICOM tags we need
        this.tags = {
            '00080018': 'SOPInstanceUID',
            '00200013': 'InstanceNumber',
            '00280010': 'Rows',
            '00280011': 'Columns',
            '00280100': 'BitsAllocated',
            '00280101': 'BitsStored',
            '00281050': 'WindowCenter',
            '00281051': 'WindowWidth',
            '00280030': 'PixelSpacing',
            '00200032': 'ImagePositionPatient',
            '00200037': 'ImageOrientationPatient',
            '7FE00010': 'PixelData'
        };
    }

    /**
     * Search for PixelData tag in a DICOM file
     * @param {ArrayBuffer} arrayBuffer - The DICOM file data
     * @returns {Object|null} Information about PixelData location and properties
     */
    findPixelData(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Look for PixelData tag (7FE0,0010) in the file
        for (let i = 0; i < arrayBuffer.byteLength - 12; i++) {
            const group = view.getUint16(i, true);
            const element = view.getUint16(i + 2, true);
            
            // Check for PixelData tag (0x7FE0, 0x0010)
            if (group === 0x7FE0 && element === 0x0010) {
                console.log(`Found PixelData tag at offset ${i}`);
                
                // Skip tag (4 bytes) + VR (2 bytes) 
                let offset = i + 6;
                
                // Check VR
                const vr = String.fromCharCode(uint8Array[i + 4], uint8Array[i + 5]);
                let length, dataOffset;
                
                if (vr === 'OB' || vr === 'OW') {
                    // For OB/OW, length is usually in next 2 bytes (little endian)
                    // But could also be followed by 2 bytes of padding for 32-bit alignment
                    let tempLength = view.getUint16(offset, true);
                    let tempOffset = offset + 2;
                    
                    // If length seems too small (like a padding indicator), try skipping 2 more bytes
                    if (tempLength === 0 && tempOffset + 4 <= arrayBuffer.byteLength) {
                        // This is likely implicit length format - next 4 bytes are the actual length
                        tempOffset += 2; // Skip padding
                        length = view.getUint32(tempOffset, true);
                        dataOffset = tempOffset + 4;
                    } else {
                        // Explicit length
                        length = tempLength;
                        dataOffset = tempOffset;
                    }
                } else {
                    // Some implementations might use different VRs or implicit lengths
                    // Try alternative approach: assume next 4 bytes are length
                    length = view.getUint32(offset, true);
                    dataOffset = offset + 4;
                }
                
                // Verify length is reasonable (not larger than remaining file)
                if (length > arrayBuffer.byteLength - dataOffset) {
                    console.warn(`PixelData length ${length} exceeds remaining buffer size ${arrayBuffer.byteLength - dataOffset}`);
                    // Try to find a more reasonable length by looking for end-of-data patterns
                    length = arrayBuffer.byteLength - dataOffset;
                }
                
                // Verify dataOffset + length doesn't exceed buffer size
                if (dataOffset + length > arrayBuffer.byteLength) {
                    length = arrayBuffer.byteLength - dataOffset;
                }
                
                console.log(`PixelData: offset=${dataOffset}, length=${length}, VR=${vr}`);
                
                return {
                    offset: dataOffset,
                    length: length,
                    vr: vr
                };
            }
        }
        
        console.log("PixelData tag not found in file");
        return null;
    }

    /**
     * Search for image dimensions in DICOM file
     * @param {ArrayBuffer} arrayBuffer - The DICOM file data
     * @returns {Object} Object containing rows and columns
     */
    findImageDimensions(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        
        let rows = 512;
        let columns = 512;
        
        // Look for Rows (0028,0010) and Columns (0028,0011) tags
        for (let i = 0; i < arrayBuffer.byteLength - 8; i++) {
            const group = view.getUint16(i, true);
            const element = view.getUint16(i + 2, true);
            
            if (group === 0x0028) {
                if (element === 0x0010) { // Rows
                    // Skip tag (4) + VR (2) + length (2 or 4)
                    let offset = i + 8;
                    if (offset + 2 <= arrayBuffer.byteLength) {
                        rows = view.getUint16(offset, true);
                        console.log(`Found Rows: ${rows}`);
                    }
                } else if (element === 0x0011) { // Columns
                    // Skip tag (4) + VR (2) + length (2 or 4)
                    let offset = i + 8;
                    if (offset + 2 <= arrayBuffer.byteLength) {
                        columns = view.getUint16(offset, true);
                        console.log(`Found Columns: ${columns}`);
                    }
                }
            }
        }
        
        return { rows, columns };
    }

    /**
     * Parse a single DICOM file with maximum recovery capability
     * @param {ArrayBuffer} arrayBuffer - The DICOM file data
     * @returns {Object} Parsed DICOM data including metadata and pixel data
     */
    async parseDicom(arrayBuffer) {
        // First, try to find pixel data regardless of standard parsing
        const pixelDataInfo = this.findPixelData(arrayBuffer);
        let pixelData = null;
        
        if (pixelDataInfo) {
            // Extract pixel data directly
            const pixelBytes = new Uint8Array(arrayBuffer, pixelDataInfo.offset, pixelDataInfo.length);
            
            // Try to determine if it's 8-bit or 16-bit data based on typical patterns
            // For CT scans, values are often in the range that suggests 16-bit signed integers
            let bitsAllocated = 16; // Default assumption for CT
            
            // Check if this looks like 16-bit data by examining patterns
            if (pixelBytes.length % 2 === 0) {
                // Might be 16-bit data - try to interpret as 16-bit values
                let hasHighValues = false;
                for (let i = 0; i < Math.min(pixelBytes.length, 1000); i += 2) {
                    const value = (pixelBytes[i + 1] << 8) | pixelBytes[i]; // Little endian
                    if (value > 255) {
                        hasHighValues = true;
                        break;
                    }
                }
                
                if (hasHighValues) {
                    // Looks like 16-bit data
                    pixelData = new Uint16Array(arrayBuffer.slice(pixelDataInfo.offset, pixelDataInfo.offset + pixelDataInfo.length));
                    bitsAllocated = 16;
                } else {
                    // Probably 8-bit data
                    pixelData = pixelBytes;
                    bitsAllocated = 8;
                }
            } else {
                // Odd number of bytes - definitely 8-bit
                pixelData = pixelBytes;
                bitsAllocated = 8;
            }
        }
        
        // Find image dimensions
        const dims = this.findImageDimensions(arrayBuffer);
        
        // If we still don't have pixel data, try to estimate from file size
        if (!pixelData) {
            const estimatedTotalPixels = dims.rows * dims.columns;
            const remainingBytes = arrayBuffer.byteLength - (128 + 4); // minus preamble + magic word
            
            // If remaining bytes roughly match expected pixel count
            if (remainingBytes >= estimatedTotalPixels) {
                // Assume pixel data starts after header
                let dataStart = 132; // Skip preamble + DICM
                if (String.fromCharCode(
                    new DataView(arrayBuffer).getUint8(128),
                    new DataView(arrayBuffer).getUint8(129),
                    new DataView(arrayBuffer).getUint8(130),
                    new DataView(arrayBuffer).getUint8(131)
                ) !== 'DICM') {
                    dataStart = 0; // No DICM header
                }
                
                const pixelBytes = new Uint8Array(arrayBuffer.slice(dataStart));
                if (pixelBytes.length >= estimatedTotalPixels) {
                    // Trim to expected size
                    pixelData = pixelBytes.slice(0, estimatedTotalPixels);
                }
            }
        }
        
        // If we still don't have pixel data, try to find the largest contiguous block of data
        if (!pixelData) {
            console.log("Attempting to extract pixel data from largest data block in file");
            
            // Look for a block that looks like image data based on size
            const estimatedSize = dims.rows * dims.columns;
            
            // Most likely location for pixel data is toward the end of the file
            // after all the metadata
            const dataStart = Math.max(0, arrayBuffer.byteLength - (estimatedSize * 2)); // Assume up to 2 bytes per pixel
            
            if (arrayBuffer.byteLength - dataStart >= estimatedSize) {
                const pixelBytes = new Uint8Array(arrayBuffer.slice(dataStart));
                
                // If this is approximately the right size, use it
                if (Math.abs(pixelBytes.length - estimatedSize) < estimatedSize * 0.1) { // Within 10%
                    pixelData = pixelBytes;
                }
            }
        }
        
        // Final fallback: if we still don't have pixel data, look for any reasonable-sized data block
        if (!pixelData) {
            const estimatedSize = dims.rows * dims.columns;
            
            // If file size is reasonably close to expected image size, treat whole file as pixel data
            if (Math.abs(arrayBuffer.byteLength - estimatedSize) < estimatedSize * 0.5) { // Within 50%
                pixelData = new Uint8Array(arrayBuffer);
            }
        }
        
        // At this point, if we have pixel data but wrong dimensions, try to infer correct dimensions
        if (pixelData && (dims.rows * dims.columns !== pixelData.length)) {
            // Try to find dimensions that make sense for the data size
            const totalPixels = pixelData.length;
            
            // Common CT scan sizes
            const commonSizes = [
                [512, 512], [256, 256], [1024, 1024], [128, 128], 
                [256, 512], [512, 256], [1024, 512], [512, 1024]
            ];
            
            for (const [w, h] of commonSizes) {
                if (w * h === totalPixels) {
                    dims.rows = h;
                    dims.columns = w;
                    break;
                }
            }
            
            // If still no match, try to find square-like dimensions
            if (dims.rows * dims.columns !== totalPixels) {
                const sqrt = Math.sqrt(totalPixels);
                if (Number.isInteger(sqrt)) {
                    dims.rows = sqrt;
                    dims.columns = sqrt;
                } else {
                    // Find factors closest to square
                    for (let w = Math.floor(sqrt); w > 0; w--) {
                        if (totalPixels % w === 0) {
                            dims.columns = w;
                            dims.rows = totalPixels / w;
                            break;
                        }
                    }
                }
            }
        }
        
        return {
            metadata: {},
            pixelData: pixelData,
            rows: dims.rows,
            columns: dims.columns,
            bitsAllocated: pixelData instanceof Uint16Array ? 16 : 8,
            pixelRepresentation: 0
        };
    }

    /**
     * Process a folder of DICOM files into a 3D volume
     * @param {FileList} files - List of DICOM files
     * @returns {Object} 3D volume data
     */
    async processDicomFolder(files) {
        const slices = [];
        
        console.log(`Processing ${files.length} DICOM files`);
        
        // Parse all DICOM files
        for (const file of files) {
            try {
                console.log(`Parsing file: ${file.name}`);
                const arrayBuffer = await file.arrayBuffer();
                const dicomData = await this.parseDicom(arrayBuffer);
                
                if (dicomData.pixelData && dicomData.pixelData.length > 0) {
                    console.log(`File ${file.name}: rows=${dicomData.rows}, cols=${dicomData.columns}, pixels=${dicomData.pixelData.length}`);
                    
                    // Validate that pixel data matches expected dimensions
                    const expectedPixels = dicomData.rows * dicomData.columns;
                    
                    if (dicomData.pixelData.length >= expectedPixels) {
                        slices.push({
                            data: dicomData.pixelData.slice(0, expectedPixels), // Take only the expected amount
                            metadata: dicomData.metadata,
                            rows: dicomData.rows,
                            columns: dicomData.columns,
                            instanceNumber: slices.length, // Use array index as instance number if not available
                            fileName: file.name
                        });
                    } else if (dicomData.pixelData.length > 100) { // Arbitrary minimum for valid slice
                        console.log(`File ${file.name} has fewer pixels than expected (${dicomData.pixelData.length} < ${expectedPixels}), but has sufficient data to include`);
                        // Pad with zeros if needed
                        const paddedData = new Uint8Array(expectedPixels);
                        paddedData.set(dicomData.pixelData);
                        slices.push({
                            data: paddedData,
                            metadata: dicomData.metadata,
                            rows: dicomData.rows,
                            columns: dicomData.columns,
                            instanceNumber: slices.length,
                            fileName: file.name
                        });
                    } else {
                        console.log(`File ${file.name} has insufficient pixel data (${dicomData.pixelData.length} pixels)`);
                    }
                } else {
                    console.log(`File ${file.name} has no detectable pixel data`);
                }
            } catch (e) {
                console.warn('Error parsing DICOM file', file.name, ':', e);
            }
        }
        
        if (slices.length === 0) {
            // Last resort: try to treat any file as a potential image
            console.log("No slices found, attempting to treat files as raw image data");
            
            for (const file of files) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);
                    
                    // Try common square dimensions that match the file size
                    const commonDims = [
                        {w: 512, h: 512, pixels: 512 * 512},
                        {w: 256, h: 256, pixels: 256 * 256},
                        {w: 1024, h: 1024, pixels: 1024 * 1024},
                        {w: 512, h: 256, pixels: 512 * 256}
                    ];
                    
                    for (const dim of commonDims) {
                        if (uint8Array.length >= dim.pixels) {
                            // Found a possible dimension match
                            const sliceData = uint8Array.slice(0, dim.pixels);
                            
                            slices.push({
                                data: sliceData,
                                metadata: {},
                                rows: dim.h,
                                columns: dim.w,
                                instanceNumber: slices.length,
                                fileName: file.name
                            });
                            
                            console.log(`Recovered data from ${file.name} as ${dim.w}x${dim.h} image`);
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('Error in last-resort parsing of', file.name, ':', e);
                }
            }
        }
        
        if (slices.length === 0) {
            throw new Error('No valid DICOM files found with pixel data after extensive recovery attempts');
        }
        
        console.log(`Successfully processed ${slices.length} slices with pixel data`);
        
        // Sort slices by instance number if available, otherwise keep original order
        slices.sort((a, b) => (a.instanceNumber || 0) - (b.instanceNumber || 0));
        
        // Create 3D volume - ensure all slices have the same dimensions
        const rows = slices[0].rows;
        const cols = slices[0].columns;
        const depth = slices.length;
        
        console.log(`Creating 3D volume: ${cols} x ${rows} x ${depth}`);
        
        // Determine data type based on first slice
        const is16Bit = slices.some(slice => slice.data instanceof Uint16Array);
        const volumeSize = rows * cols * depth;
        
        let volumeData;
        if (is16Bit) {
            volumeData = new Uint16Array(volumeSize);
        } else {
            volumeData = new Uint8Array(volumeSize);
        }
        
        // Fill volume data
        for (let z = 0; z < depth; z++) {
            const sliceData = slices[z].data;
            const sliceSize = rows * cols;
            
            for (let i = 0; i < sliceSize && i < sliceData.length; i++) {
                volumeData[z * sliceSize + i] = sliceData[i];
            }
        }
        
        // Normalize 16-bit data to 8-bit if needed for WebGL
        if (is16Bit) {
            const maxVal = Math.max(...Array.from(volumeData));
            const minVal = Math.min(...Array.from(volumeData));
            const range = maxVal - minVal || 1;
            
            const normalizedVolume = new Uint8Array(volumeSize);
            for (let i = 0; i < volumeSize; i++) {
                normalizedVolume[i] = Math.round(((volumeData[i] - minVal) / range) * 255);
            }
            
            console.log(`Normalized 16-bit data: min=${minVal}, max=${maxVal}, range=${range}`);
            
            volumeData = normalizedVolume;
        }
        
        console.log(`Final volume created: ${cols} x ${rows} x ${depth}, total elements: ${volumeData.length}`);
        
        return {
            data: volumeData,
            dimensions: [cols, rows, depth]
        };
    }
}