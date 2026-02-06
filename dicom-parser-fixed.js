/**
 * Robust DICOM Parser for Browser
 * Handles parsing of DICOM files and extraction of pixel data
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
     * Parse a single DICOM file
     * @param {ArrayBuffer} arrayBuffer - The DICOM file data
     * @returns {Object} Parsed DICOM data including metadata and pixel data
     */
    async parseDicom(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Check for DICOM magic word at offset 128
        let offset = 0;
        
        // Skip preamble (128 bytes) and magic word ('DICM')
        if (arrayBuffer.byteLength > 132) {
            const magicWord = String.fromCharCode(
                view.getUint8(128),
                view.getUint8(129),
                view.getUint8(130),
                view.getUint8(131)
            );
            
            if (magicWord === 'DICM') {
                offset = 132;
            } else {
                offset = 0; // Raw DICOM without preamble
            }
        }
        
        const metadata = {};
        let pixelData = null;
        let rows = 0;
        let columns = 0;
        let bitsAllocated = 8;
        let pixelRepresentation = 0; // 0=unsigned, 1=signed
        
        // Parse DICOM tags
        while (offset < arrayBuffer.byteLength - 8) {
            try {
                const group = view.getUint16(offset, true).toString(16).padStart(4, '0');
                const element = view.getUint16(offset + 2, true).toString(16).padStart(4, '0');
                const tag = group + element;
                
                // Verify we have enough bytes to read the tag
                if (offset + 8 > arrayBuffer.byteLength) {
                    console.warn(`Not enough bytes left to read tag at offset ${offset}`);
                    break;
                }
                
                const vr = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5));
                let length, valueOffset;
                
                // Determine length based on VR type
                if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
                    // Implicit VR - length is 4 bytes
                    offset += 6;
                    if (offset + 4 <= arrayBuffer.byteLength) {
                        // Check for group length tag
                        if (view.getUint32(offset, true) !== 0x00000000) {
                            // Group Length follows
                            offset += 4;
                        }
                    } else {
                        break; // Not enough bytes left
                    }
                    if (offset + 4 <= arrayBuffer.byteLength) {
                        length = view.getUint32(offset, true);
                        offset += 4;
                        valueOffset = offset;
                    } else {
                        break; // Not enough bytes left
                    }
                } else {
                    // Explicit VR - length is 2 bytes
                    offset += 6;
                    if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
                        // Some VR types have 4-byte lengths even when explicit
                        offset += 2; // Padding
                        if (offset + 4 <= arrayBuffer.byteLength) {
                            length = view.getUint32(offset, true);
                            offset += 4;
                            valueOffset = offset;
                        } else {
                            break; // Not enough bytes left
                        }
                    } else {
                        if (offset + 2 <= arrayBuffer.byteLength) {
                            length = view.getUint16(offset, true);
                            offset += 2;
                            valueOffset = offset;
                        } else {
                            break; // Not enough bytes left
                        }
                    }
                }
                
                // Check if we have enough data for this tag
                if (valueOffset + length > arrayBuffer.byteLength) {
                    console.warn(`Tag ${tag} extends beyond buffer bounds, skipping. Buffer size: ${arrayBuffer.byteLength}, needed: ${valueOffset + length}`);
                    // Try to recover by looking for the next tag
                    offset = valueOffset;
                    continue;
                }
                
                if (tag === '7FE00010') { // PixelData
                    // Extract pixel data
                    if (vr === 'OW' || vr === 'OB') {
                        if (bitsAllocated === 16) {
                            // 16-bit data
                            if (pixelRepresentation === 1) {
                                // Signed 16-bit
                                pixelData = new Int16Array(arrayBuffer.slice(valueOffset, valueOffset + length));
                            } else {
                                // Unsigned 16-bit
                                pixelData = new Uint16Array(arrayBuffer.slice(valueOffset, valueOffset + length));
                            }
                        } else {
                            // 8-bit data
                            pixelData = new Uint8Array(arrayBuffer.slice(valueOffset, valueOffset + length));
                        }
                    }
                } else if (tag === '00280010') { // Rows
                    metadata[tag] = view.getUint16(valueOffset, true);
                    rows = metadata[tag];
                } else if (tag === '00280011') { // Columns
                    metadata[tag] = view.getUint16(valueOffset, true);
                    columns = metadata[tag];
                } else if (tag === '00280100') { // BitsAllocated
                    metadata[tag] = view.getUint16(valueOffset, true);
                    bitsAllocated = metadata[tag];
                } else if (tag === '00280103') { // PixelRepresentation (0=unsigned, 1=signed)
                    metadata[tag] = view.getUint16(valueOffset, true);
                    pixelRepresentation = metadata[tag];
                } else if (tag === '00281050') { // WindowCenter
                    if (length === 2) {
                        metadata[tag] = view.getInt16(valueOffset, true);
                    } else if (length === 4) {
                        metadata[tag] = view.getInt32(valueOffset, true);
                    } else {
                        // Handle string values (multiple centers)
                        let str = '';
                        for (let i = valueOffset; i < valueOffset + Math.min(length, 100); i++) {
                            if (i >= arrayBuffer.byteLength) break;
                            const char = String.fromCharCode(view.getUint8(i));
                            if (char !== '\0') str += char;
                        }
                        const nums = str.split('\\').map(Number).filter(n => !isNaN(n));
                        metadata[tag] = nums.length > 0 ? nums[0] : 0;
                    }
                } else if (tag === '00281051') { // WindowWidth
                    if (length === 2) {
                        metadata[tag] = view.getUint16(valueOffset, true);
                    } else if (length === 4) {
                        metadata[tag] = view.getUint32(valueOffset, true);
                    } else {
                        // Handle string values (multiple widths)
                        let str = '';
                        for (let i = valueOffset; i < valueOffset + Math.min(length, 100); i++) {
                            if (i >= arrayBuffer.byteLength) break;
                            const char = String.fromCharCode(view.getUint8(i));
                            if (char !== '\0') str += char;
                        }
                        const nums = str.split('\\').map(Number).filter(n => !isNaN(n));
                        metadata[tag] = nums.length > 0 ? nums[0] : 0;
                    }
                } else if (tag === '00200013') { // InstanceNumber
                    if (length === 2) {
                        metadata[tag] = view.getUint16(valueOffset, true);
                    } else if (length === 4) {
                        metadata[tag] = view.getUint32(valueOffset, true);
                    } else {
                        // Handle string values
                        let str = '';
                        for (let i = valueOffset; i < valueOffset + Math.min(length, 100); i++) {
                            if (i >= arrayBuffer.byteLength) break;
                            const char = String.fromCharCode(view.getUint8(i));
                            if (char !== '\0') str += char;
                        }
                        const num = parseInt(str, 10);
                        metadata[tag] = isNaN(num) ? 0 : num;
                    }
                }
                
                // Move to next tag
                offset = valueOffset + length;
                
                // Align to even boundary
                if (length % 2 === 1 && vr !== 'SQ' && vr !== 'UT') {
                    offset += 1;
                }
            } catch (e) {
                // If we encounter an error, try to continue parsing
                console.warn('Error parsing DICOM tag at offset', offset, ':', e);
                // Skip ahead by a reasonable amount and continue
                offset += 16;
                if (offset >= arrayBuffer.byteLength) break;
            }
        }
        
        // If we couldn't extract dimensions from metadata, estimate them
        if (!rows || !columns) {
            // If we have pixel data, try to estimate dimensions
            if (pixelData && pixelData.length > 0) {
                const totalPixels = pixelData.length;
                const sideLength = Math.sqrt(totalPixels);
                if (Number.isInteger(sideLength)) {
                    rows = sideLength;
                    columns = sideLength;
                } else {
                    // Common DICOM sizes
                    if (totalPixels === 512 * 512) {
                        rows = 512;
                        columns = 512;
                    } else if (totalPixels === 256 * 256) {
                        rows = 256;
                        columns = 256;
                    } else if (totalPixels === 1024 * 1024) {
                        rows = 1024;
                        columns = 1024;
                    } else {
                        // Default fallback
                        rows = Math.floor(Math.sqrt(totalPixels));
                        columns = Math.ceil(Math.sqrt(totalPixels));
                    }
                }
            } else {
                // Fallback if no pixel data
                rows = 512;
                columns = 512;
            }
        }
        
        return {
            metadata,
            pixelData,
            rows,
            columns,
            bitsAllocated,
            pixelRepresentation
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
                    console.log(`File ${file.name}: rows=${dicomData.rows}, cols=${dicomData.columns}, pixels=${dicomData.pixelData.length}, has pixel data: true`);
                    
                    // Validate that pixel data matches expected dimensions
                    const expectedPixels = dicomData.rows * dicomData.columns;
                    
                    if (dicomData.pixelData.length >= expectedPixels) {
                        slices.push({
                            data: dicomData.pixelData.slice(0, expectedPixels), // Take only the expected amount
                            metadata: dicomData.metadata,
                            rows: dicomData.rows,
                            columns: dicomData.columns,
                            instanceNumber: dicomData.metadata['00200013'] || 0,
                            fileName: file.name
                        });
                    } else {
                        console.warn(`File ${file.name} has fewer pixels than expected (${dicomData.pixelData.length} < ${expectedPixels}), but still adding it`);
                        // Still add it if it has some pixel data
                        if (dicomData.pixelData.length > 100) { // Arbitrary minimum
                            // Pad with zeros if needed
                            const paddedData = new Uint8Array(expectedPixels);
                            paddedData.set(dicomData.pixelData);
                            slices.push({
                                data: paddedData,
                                metadata: dicomData.metadata,
                                rows: dicomData.rows,
                                columns: dicomData.columns,
                                instanceNumber: dicomData.metadata['00200013'] || 0,
                                fileName: file.name
                            });
                        }
                    }
                } else {
                    console.log(`File ${file.name} has no pixel data`);
                }
            } catch (e) {
                console.warn('Error parsing DICOM file', file.name, ':', e);
            }
        }
        
        if (slices.length === 0) {
            // Try to find any files with pixel data even if they weren't properly identified
            for (const file of files) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    // Look for any potential pixel data by checking for common patterns
                    const view = new DataView(arrayBuffer);
                    
                    // Look for PixelData tag (7FE0,0010) in the file
                    for (let i = 0; i < arrayBuffer.byteLength - 4; i++) {
                        const group = view.getUint16(i, true).toString(16).padStart(4, '0');
                        const element = view.getUint16(i + 2, true).toString(16).padStart(4, '0');
                        
                        if (group === '7fe0' && element === '0010') {
                            // Found PixelData tag, try to extract it
                            // Skip the VR field
                            let dataOffset = i + 8; // Usually after tag+VR+length
                            if (dataOffset + 4 <= arrayBuffer.byteLength) {
                                // Get length of pixel data
                                const pixelDataLength = view.getUint32(dataOffset, true);
                                dataOffset += 4;
                                
                                if (dataOffset + pixelDataLength <= arrayBuffer.byteLength) {
                                    // Extract the pixel data
                                    const pixelData = new Uint8Array(arrayBuffer.slice(dataOffset, dataOffset + pixelDataLength));
                                    
                                    // Try to determine dimensions from metadata elsewhere in the file
                                    let rows = 512, cols = 512;
                                    
                                    // Look for rows and columns in the file
                                    for (let j = 0; j < arrayBuffer.byteLength - 8; j++) {
                                        const tagGroup = view.getUint16(j, true).toString(16).padStart(4, '0');
                                        const tagElement = view.getUint16(j + 2, true).toString(16).padStart(4, '0');
                                        
                                        if (tagGroup === '0028') {
                                            if (tagElement === '0010') { // Rows
                                                const offsetToValue = j + 8; // Skip tag+VR+length
                                                if (offsetToValue + 2 <= arrayBuffer.byteLength) {
                                                    rows = view.getUint16(offsetToValue, true);
                                                }
                                            } else if (tagElement === '0011') { // Columns
                                                const offsetToValue = j + 8; // Skip tag+VR+length
                                                if (offsetToValue + 2 <= arrayBuffer.byteLength) {
                                                    cols = view.getUint16(offsetToValue, true);
                                                }
                                            }
                                        }
                                    }
                                    
                                    // If we still have valid pixel data, add it as a slice
                                    if (pixelData.length > 100) {
                                        const expectedPixels = rows * cols;
                                        let sliceData = pixelData;
                                        
                                        if (pixelData.length >= expectedPixels) {
                                            sliceData = pixelData.slice(0, expectedPixels);
                                        } else {
                                            // Pad with zeros
                                            const paddedData = new Uint8Array(expectedPixels);
                                            paddedData.set(pixelData);
                                            sliceData = paddedData;
                                        }
                                        
                                        slices.push({
                                            data: sliceData,
                                            metadata: {},
                                            rows: rows,
                                            columns: cols,
                                            instanceNumber: slices.length, // Use array index as instance number
                                            fileName: file.name
                                        });
                                        
                                        console.log(`Recovered pixel data from ${file.name}: ${cols}x${rows}, ${sliceData.length} pixels`);
                                        break; // Move to next file after finding pixel data
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Error trying to recover pixel data from', file.name, ':', e);
                }
            }
        }
        
        if (slices.length === 0) {
            throw new Error('No valid DICOM files found with pixel data');
        }
        
        console.log(`Successfully processed ${slices.length} slices with pixel data`);
        
        // Sort slices by instance number if available, otherwise by filename
        slices.sort((a, b) => {
            if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
                return (a.instanceNumber || 0) - (b.instanceNumber || 0);
            } else {
                return a.fileName.localeCompare(b.fileName);
            }
        });
        
        // Create 3D volume - ensure all slices have the same dimensions
        const rows = slices[0].rows;
        const cols = slices[0].columns;
        const depth = slices.length;
        
        console.log(`Creating 3D volume: ${cols} x ${rows} x ${depth}`);
        
        // Determine data type based on first slice
        const is16Bit = slices.some(slice => slice.data instanceof Uint16Array || slice.data instanceof Int16Array);
        const volumeSize = rows * cols * depth;
        
        let volumeData;
        if (is16Bit) {
            // Check if any slices have signed data
            const isSigned = slices.some(slice => slice.data instanceof Int16Array);
            if (isSigned) {
                volumeData = new Int16Array(volumeSize);
            } else {
                volumeData = new Uint16Array(volumeSize);
            }
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