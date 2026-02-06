/**
 * WebGL-based 3D Volume Renderer
 * Implements ray casting for volumetric rendering
 */
class VolumeRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        
        this.init();
    }
    
    init() {
        this.setupShaders();
        this.setupBuffers();
        this.setupTextures();
        this.setupUniforms();
        
        // Initialize camera
        this.rotationX = 0;
        this.rotationY = 0;
        this.zoom = 1.0;
        
        // Initialize volume properties
        this.threshold = 100;
        this.opacity = 0.8;
        this.windowLevel = 128;
        this.windowWidth = 256;
        this.volumeData = null;
        this.volumeTexture = null;
        
        // Mouse interaction
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        this.setupMouseHandlers();
    }
    
    setupShaders() {
        // Vertex shader - renders a full-screen quad
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_position + 1.0) * 0.5;
            }
        `;
        
        // Fragment shader for ray casting volume rendering
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec2 v_texCoord;
            uniform sampler2D u_volumeTexture;
            uniform float u_textureWidth;
            uniform float u_textureHeight;
            uniform float u_slices;
            uniform float u_threshold;
            uniform float u_opacity;
            uniform float u_windowLevel;
            uniform float u_windowWidth;
            uniform vec3 u_volumeSize;
            uniform float u_zoom;
            uniform float u_rotationX;
            uniform float u_rotationY;
            
            // Function to sample volume texture at 3D position
            float sampleVolume(vec3 pos) {
                // Clamp position to [0.001, 0.999] to avoid edge artifacts
                pos = clamp(pos, 0.001, 0.999);
                
                // Calculate slice index and interpolation factor
                float sliceF = pos.z * u_slices;
                float sliceIdx = floor(sliceF);
                float sliceFrac = fract(sliceF);
                
                // Calculate texture coordinates for current slice
                vec2 uv = pos.xy;
                
                // Calculate texture coordinates accounting for slice layout
                float slicesPerRow = ceil(sqrt(u_slices));
                float row = floor(sliceIdx / slicesPerRow);
                float col = mod(sliceIdx, slicesPerRow);
                
                vec2 sliceSize = vec2(u_volumeSize.x / u_textureWidth, u_volumeSize.y / u_textureHeight);
                vec2 sliceOffset = vec2(col * u_volumeSize.x / u_textureWidth, row * u_volumeSize.y / u_textureHeight);
                
                uv = uv * sliceSize + sliceOffset;
                
                float value1 = texture2D(u_volumeTexture, uv).r;
                
                // Interpolate between slices if needed
                if (sliceFrac > 0.0 && sliceIdx < u_slices - 1.0) {
                    float nextSliceIdx = sliceIdx + 1.0;
                    float nextRow = floor(nextSliceIdx / slicesPerRow);
                    float nextCol = mod(nextSliceIdx, slicesPerRow);
                    
                    vec2 nextSliceOffset = vec2(nextCol * u_volumeSize.x / u_textureWidth, nextRow * u_volumeSize.y / u_textureHeight);
                    vec2 nextUv = uv - sliceOffset + nextSliceOffset;
                    
                    float value2 = texture2D(u_volumeTexture, nextUv).r;
                    return mix(value1, value2, sliceFrac);
                }
                
                return value1;
            }
            
            void main() {
                // If no volume loaded, show a gradient background
                if (u_slices <= 0.0) {
                    float r = v_texCoord.x;
                    float g = v_texCoord.y;
                    float b = 0.2;
                    gl_FragColor = vec4(r, g, b, 1.0);
                    return;
                }
                
                // Set up ray parameters
                vec3 rayDir = vec3(v_texCoord - 0.5, 0.0);
                rayDir.z = -1.0; // Point into the volume
                rayDir = normalize(rayDir);
                
                // Apply rotations
                float cosX = cos(u_rotationX);
                float sinX = sin(u_rotationX);
                float cosY = cos(u_rotationY);
                float sinY = sin(u_rotationY);
                
                // Rotation matrices
                mat3 rotY = mat3(
                    cosY, 0.0, -sinY,
                    0.0, 1.0, 0.0,
                    sinY, 0.0, cosY
                );
                
                mat3 rotX = mat3(
                    1.0, 0.0, 0.0,
                    0.0, cosX, -sinX,
                    0.0, sinX, cosX
                );
                
                rayDir = rotY * rotX * rayDir;
                
                // Ray origin (centered in the volume)
                vec3 rayOrigin = vec3(0.5, 0.5, 0.5);
                
                // Volume boundaries
                vec3 volumeMin = vec3(0.0);
                vec3 volumeMax = vec3(1.0);
                
                // Simple ray-volume intersection (for unit cube)
                vec3 t1 = (volumeMin - rayOrigin) / rayDir;
                vec3 t2 = (volumeMax - rayOrigin) / rayDir;
                
                vec3 tNear3 = min(t1, t2);
                vec3 tFar3 = max(t1, t2);
                
                float tNear = max(max(tNear3.x, tNear3.y), tNear3.z);
                float tFar = min(min(tFar3.x, tFar3.y), tFar3.z);
                
                // If ray doesn't intersect volume, return background
                if (tNear > tFar || tFar < 0.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }
                
                // Start ray marching
                vec3 startPos = rayOrigin + rayDir * max(0.0, tNear);
                vec3 step = rayDir * 0.005; // Step size - smaller for more detail
                vec3 currentPosition = startPos;
                
                vec4 accumulatedColor = vec4(0.0);
                float accumulatedAlpha = 0.0;
                int steps = 0;
                
                // Ray marching loop
                for (int i = 0; i < 200; i++) {
                    if (accumulatedAlpha >= 0.95 || steps > 200) {
                        break;
                    }
                    
                    // Check if we're still in the volume
                    if (currentPosition.x < 0.0 || currentPosition.x > 1.0 ||
                        currentPosition.y < 0.0 || currentPosition.y > 1.0 ||
                        currentPosition.z < 0.0 || currentPosition.z > 1.0) {
                        break;
                    }
                    
                    // Sample the volume at current position
                    float density = sampleVolume(currentPosition);
                    
                    // Apply window leveling
                    float windowMin = u_windowLevel - u_windowWidth * 0.5;
                    float windowMax = u_windowLevel + u_windowWidth * 0.5;
                    
                    float normalizedDensity = (density - windowMin) / (windowMax - windowMin);
                    normalizedDensity = clamp(normalizedDensity, 0.0, 1.0);
                    
                    // Only process if above threshold
                    if (normalizedDensity > u_threshold / 255.0) {
                        // Simple coloring based on density
                        float intensity = normalizedDensity;
                        
                        // Create a color based on intensity and position for better visualization
                        vec3 color = vec3(intensity);
                        
                        // Create alpha based on density and opacity setting
                        float alpha = intensity * u_opacity * 0.05; // Scale down for proper blending
                        
                        // Front-to-back alpha compositing
                        vec4 newColor = vec4(color * alpha, alpha);
                        accumulatedColor = accumulatedColor + newColor * (1.0 - accumulatedAlpha);
                        accumulatedAlpha = accumulatedAlpha + alpha * (1.0 - accumulatedAlpha);
                    }
                    
                    // Move to next position
                    currentPosition += step;
                    steps++;
                }
                
                // Output the final color with proper alpha
                if (accumulatedAlpha > 0.0) {
                    gl_FragColor = vec4(accumulatedColor.rgb / accumulatedAlpha, accumulatedAlpha);
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                }
            }
        `;
        
        this.vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        this.fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        if (this.vertexShader && this.fragmentShader) {
            this.program = this.createProgram(this.vertexShader, this.fragmentShader);
        }
    }
    
    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            console.log('Shader source:', source.substring(0, 500) + '...');
            this.gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking error:', this.gl.getProgramInfoLog(program));
            this.gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }
    
    setupBuffers() {
        // Full screen quad vertices
        this.quadVertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]);
        
        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.quadVertices, this.gl.STATIC_DRAW);
    }
    
    setupTextures() {
        this.volumeTexture = this.gl.createTexture();
    }
    
    setupUniforms() {
        this.gl.useProgram(this.program);
        this.uniformLocations = {
            volumeTexture: this.gl.getUniformLocation(this.program, 'u_volumeTexture'),
            textureWidth: this.gl.getUniformLocation(this.program, 'u_textureWidth'),
            textureHeight: this.gl.getUniformLocation(this.program, 'u_textureHeight'),
            slices: this.gl.getUniformLocation(this.program, 'u_slices'),
            threshold: this.gl.getUniformLocation(this.program, 'u_threshold'),
            opacity: this.gl.getUniformLocation(this.program, 'u_opacity'),
            windowLevel: this.gl.getUniformLocation(this.program, 'u_windowLevel'),
            windowWidth: this.gl.getUniformLocation(this.program, 'u_windowWidth'),
            volumeSize: this.gl.getUniformLocation(this.program, 'u_volumeSize'),
            u_zoom: this.gl.getUniformLocation(this.program, 'u_zoom'),
            u_rotationX: this.gl.getUniformLocation(this.program, 'u_rotationX'),
            u_rotationY: this.gl.getUniformLocation(this.program, 'u_rotationY')
        };
    }
    
    setupMouseHandlers() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const deltaX = e.clientX - this.lastMouseX;
                const deltaY = e.clientY - this.lastMouseY;
                
                // Update rotation based on mouse movement
                this.rotationY += deltaX * 0.01;
                this.rotationX += deltaY * 0.01;
                
                // Clamp vertical rotation to avoid flipping
                this.rotationX = Math.max(-1.57, Math.min(1.57, this.rotationX));
                
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Adjust zoom with scroll
            this.zoom += e.deltaY * -0.001;
            this.zoom = Math.max(0.1, Math.min(3.0, this.zoom));
        });
    }
    
    setSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }
    
    loadVolume(volumeData) {
        this.volumeData = volumeData;
        
        const [width, height, depth] = volumeData.dimensions;
        
        console.log(`Loading volume: ${width} x ${height} x ${depth}, total data points: ${volumeData.data.length}`);
        
        // Validate dimensions against data length
        const expectedSize = width * height * depth;
        if (volumeData.data.length !== expectedSize) {
            console.warn(`Data size mismatch: expected ${expectedSize}, got ${volumeData.data.length}`);
            
            // Try to fix by calculating actual dimensions
            if (volumeData.data.length > 0) {
                // For a CT scan, we typically have many slices of equal size
                // Let's try to guess dimensions by finding factors
                
                // If we have a likely number of slices
                const likelySlices = depth; // Use provided depth as hint
                const likelySliceSize = Math.floor(volumeData.data.length / likelySlices);
                
                // Find factors of slice size that are reasonable for CT images
                let foundFactors = false;
                let actualWidth = width, actualHeight = height;
                
                // Try common CT dimensions
                const commonDims = [64, 128, 256, 512, 1024];
                for (const dim of commonDims) {
                    if (likelySliceSize % dim === 0) {
                        const otherDim = likelySliceSize / dim;
                        if (commonDims.includes(otherDim)) {
                            actualWidth = dim;
                            actualHeight = otherDim;
                            foundFactors = true;
                            break;
                        }
                    }
                }
                
                if (!foundFactors) {
                    // Try square dimensions
                    const sqrt = Math.sqrt(likelySliceSize);
                    if (Number.isInteger(sqrt)) {
                        actualWidth = sqrt;
                        actualHeight = sqrt;
                        foundFactors = true;
                    }
                }
                
                if (foundFactors) {
                    console.log(`Adjusted dimensions: ${actualWidth} x ${actualHeight} x ${likelySlices}`);
                    
                    // Update dimensions
                    const newWidth = actualWidth;
                    const newHeight = actualHeight;
                    const newDepth = Math.floor(volumeData.data.length / (newWidth * newHeight));
                    
                    console.log(`Final adjusted dimensions: ${newWidth} x ${newHeight} x ${newDepth}`);
                    
                    // Recalculate with corrected dimensions
                    const slicesPerRow = Math.ceil(Math.sqrt(newDepth));
                    const rows = Math.ceil(newDepth / slicesPerRow);
                    
                    const texWidth = slicesPerRow * newWidth;
                    const texHeight = rows * newHeight;
                    
                    console.log(`Texture size: ${texWidth} x ${texHeight} (slices per row: ${slicesPerRow})`);
                    
                    // Create texture data
                    const textureData = new Uint8Array(texWidth * texHeight);
                    
                    // Fill texture data with actual available data
                    for (let z = 0; z < newDepth; z++) {
                        const sliceRow = Math.floor(z / slicesPerRow);
                        const sliceCol = z % slicesPerRow;
                        
                        for (let y = 0; y < newHeight; y++) {
                            for (let x = 0; x < newWidth; x++) {
                                const volumeIdx = z * newWidth * newHeight + y * newWidth + x;
                                
                                // Check if we have data for this index
                                if (volumeIdx < volumeData.data.length) {
                                    const texX = sliceCol * newWidth + x;
                                    const texY = sliceRow * newHeight + y;
                                    const texIdx = texY * texWidth + texX;
                                    
                                    // Ensure we don't go out of bounds
                                    if (texIdx < textureData.length) {
                                        textureData[texIdx] = Math.max(0, Math.min(255, Math.round(volumeData.data[volumeIdx])));
                                    }
                                }
                            }
                        }
                    }
                    
                    // Ensure we have a valid texture
                    if (!this.volumeTexture) {
                        this.volumeTexture = this.gl.createTexture();
                    }
                    
                    // Upload texture - bind texture before setting parameters
                    this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
                    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
                    
                    this.gl.texImage2D(
                        this.gl.TEXTURE_2D,
                        0,
                        this.gl.LUMINANCE,
                        texWidth,
                        texHeight,
                        0,
                        this.gl.LUMINANCE,
                        this.gl.UNSIGNED_BYTE,
                        textureData
                    );
                    
                    // Unbind texture after uploading
                    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
                    
                    this.textureLayout = {
                        width: texWidth,
                        height: texHeight,
                        slices: newDepth,
                        volumeSize: [newWidth, newHeight, newDepth]
                    };
                    
                    return; // Exit early after fixing dimensions
                }
            }
        }
        
        // Original logic for when dimensions match
        // Calculate texture layout
        const slicesPerRow = Math.ceil(Math.sqrt(depth));
        const rows = Math.ceil(depth / slicesPerRow);
        
        const texWidth = slicesPerRow * width;
        const texHeight = rows * height;
        
        console.log(`Original texture size: ${texWidth} x ${texHeight} (slices per row: ${slicesPerRow})`);
        
        // Create texture data
        const textureData = new Uint8Array(texWidth * texHeight);
        
        // Fill texture data
        for (let z = 0; z < depth; z++) {
            const sliceRow = Math.floor(z / slicesPerRow);
            const sliceCol = z % slicesPerRow;
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const volumeIdx = z * width * height + y * width + x;
                    const texX = sliceCol * width + x;
                    const texY = sliceRow * height + y;
                    const texIdx = texY * texWidth + texX;
                    
                    // Ensure we don't go out of bounds
                    if (volumeIdx < volumeData.data.length && texIdx < textureData.length) {
                        textureData[texIdx] = Math.max(0, Math.min(255, Math.round(volumeData.data[volumeIdx])));
                    }
                }
            }
        }
        
        // Ensure we have a valid texture
        if (!this.volumeTexture) {
            this.volumeTexture = this.gl.createTexture();
        }
        
        // Upload texture - bind texture before setting parameters
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.LUMINANCE,
            texWidth,
            texHeight,
            0,
            this.gl.LUMINANCE,
            this.gl.UNSIGNED_BYTE,
            textureData
        );
        
        // Unbind texture after uploading
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        
        this.textureLayout = {
            width: texWidth,
            height: texHeight,
            slices: depth,
            volumeSize: [width, height, depth]
        };
    }
    
    setThreshold(value) {
        this.threshold = value;
    }
    
    setOpacity(value) {
        this.opacity = value;
    }
    
    setWindowLevel(value) {
        this.windowLevel = value;
    }
    
    setWindowWidth(value) {
        this.windowWidth = value;
    }
    
    getSliceCount() {
        return this.textureLayout ? this.textureLayout.slices : 0;
    }
    
    render() {
        if (!this.program) return;
        
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        this.gl.useProgram(this.program);
        
        // Set up vertex attributes
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        const positionAttributeLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(positionAttributeLocation);
        this.gl.vertexAttribPointer(positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);
        
        // Set texture and uniforms
        if (this.volumeTexture && this.textureLayout) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
            this.gl.uniform1i(this.uniformLocations.volumeTexture, 0);
            
            this.gl.uniform1f(this.uniformLocations.textureWidth, this.textureLayout.width);
            this.gl.uniform1f(this.uniformLocations.textureHeight, this.textureLayout.height);
            this.gl.uniform1f(this.uniformLocations.slices, this.textureLayout.slices);
            this.gl.uniform3f(this.uniformLocations.volumeSize,
                             this.textureLayout.volumeSize[0],
                             this.textureLayout.volumeSize[1],
                             this.textureLayout.volumeSize[2]);
        } else {
            // Default values when no volume loaded
            this.gl.uniform1f(this.uniformLocations.slices, 0);
            this.gl.uniform1f(this.uniformLocations.textureWidth, 1);
            this.gl.uniform1f(this.uniformLocations.textureHeight, 1);
            this.gl.uniform3f(this.uniformLocations.volumeSize, 1, 1, 1);
        }
        
        this.gl.uniform1f(this.uniformLocations.threshold, this.threshold);
        this.gl.uniform1f(this.uniformLocations.opacity, this.opacity);
        this.gl.uniform1f(this.uniformLocations.windowLevel, this.windowLevel);
        this.gl.uniform1f(this.uniformLocations.windowWidth, this.windowWidth);
        this.gl.uniform1f(this.uniformLocations.u_zoom, this.zoom);
        this.gl.uniform1f(this.uniformLocations.u_rotationX, this.rotationX);
        this.gl.uniform1f(this.uniformLocations.u_rotationY, this.rotationY);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
}// Auto-refresh to trigger GitHub Pages deployment
