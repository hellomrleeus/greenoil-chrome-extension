#!/usr/bin/env python3
import struct
import zlib
import os
import math

def create_png(width, height, rgba_data):
    # PNG signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    png += struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk
    raw_scanlines = bytearray()
    for y in range(height):
        raw_scanlines.append(0)  # filter type 0 (None)
        start_idx = y * width * 4
        raw_scanlines.extend(rgba_data[start_idx : start_idx + width * 4])
        
    compressed_idat = zlib.compress(bytes(raw_scanlines), level=9)
    idat_crc = zlib.crc32(b'IDAT' + compressed_idat) & 0xffffffff
    png += struct.pack('>I', len(compressed_idat)) + b'IDAT' + compressed_idat + struct.pack('>I', idat_crc)
    
    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    png += struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    return png

def render_icon(size):
    # Green Oil primary brand colors
    # BG: #059669 (5, 150, 105)
    # Accent: White #FFFFFF
    rgba = bytearray(size * size * 4)
    radius = size * 0.44
    cx, cy = size / 2.0, size / 2.0

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = math.sqrt(dx * dx + dy * dy)
            
            # Anti-aliased circle edge
            edge_dist = radius - dist
            if edge_dist < -1.0:
                # Fully outside
                rgba[idx] = 0
                rgba[idx+1] = 0
                rgba[idx+2] = 0
                rgba[idx+3] = 0
                continue
            
            alpha_bg = max(0.0, min(1.0, edge_dist + 1.0))
            
            # Inner shape: Map pin / Leaf droplet
            # Normalized coordinates (-1 to 1)
            nx = dx / radius
            ny = dy / radius
            
            # Draw an elegant droplet / pin path
            # Pin head: circle around ny = -0.15, r = 0.45
            pin_head_dist = math.sqrt(nx * nx + (ny - (-0.15)) ** 2)
            # Pin point: triangle tapering towards ny = 0.65, nx = 0
            is_pin = False
            if pin_head_dist <= 0.42:
                is_pin = True
            elif ny > -0.15 and ny <= 0.68:
                width_at_y = 0.42 * (1.0 - (ny - (-0.15)) / 0.83)
                if abs(nx) <= width_at_y:
                    is_pin = True
            
            # Inner cutout circle inside pin head (ny = -0.15, r = 0.18)
            inner_dot = math.sqrt(nx * nx + (ny - (-0.15)) ** 2)
            if inner_dot <= 0.18:
                is_pin = False

            if is_pin:
                # White pin
                r, g, b = 255, 255, 255
            else:
                # Emerald green background (#059669)
                r, g, b = 5, 150, 105
                
            rgba[idx] = r
            rgba[idx+1] = g
            rgba[idx+2] = b
            rgba[idx+3] = int(alpha_bg * 255)

    return create_png(size, size, rgba)

def main():
    icons_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(icons_dir, exist_ok=True)
    
    sizes = [16, 32, 48, 128]
    for s in sizes:
        png_data = render_icon(s)
        filepath = os.path.join(icons_dir, f"icon-{s}.png")
        with open(filepath, "wb") as f:
            f.write(png_data)
        print(f"Generated {filepath} ({s}x{s})")

if __name__ == "__main__":
    main()
