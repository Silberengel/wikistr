#!/usr/bin/env ruby
require 'sinatra'
require 'puma'
require 'rack'
require 'asciidoctor'
require 'asciidoctor-epub3'
require 'asciidoctor-pdf'  # For PDF conversion
require 'asciidoctor-diagram'  # For PlantUML, Graphviz, BPMN, Mermaid, TikZ, etc.
require 'json'
require 'tempfile'
require 'fileutils'
require 'pathname'
require 'zip'
require 'yaml'

# Set port and bind - use environment variable or default to 8091
set :port, ENV.fetch('ASCIIDOCTOR_PORT', 8091).to_i
set :bind, '0.0.0.0'  # Bind to all interfaces so it can be accessed from Docker network
set :server, 'puma'
set :protection, false  # Disable CSRF protection for API (not needed for REST API)

# Increase request body size limit to support large documents (e.g., full Bible ~4MB)
# Default Rack limit is 1MB, we increase to 50MB to handle very large books
Rack::Utils.key_space_limit = 50 * 1024 * 1024 # 50MB

# Configure Puma to handle larger requests
configure do
  # Puma will handle request body size limits
  # For very large documents (50MB+), Puma's default settings should handle it
  set :server_settings, 
    max_threads: 5, 
    min_threads: 2
end

# CORS configuration - always allow all origins for development
# In production, set ASCIIDOCTOR_ALLOW_ORIGIN environment variable
before do
  origin = request.env['HTTP_ORIGIN']
  allowed_origins = (ENV['ASCIIDOCTOR_ALLOW_ORIGIN'] || '*').split(',').map(&:strip).reject(&:empty?)
  
  # Always set CORS headers - default to allow all origins
  cors_origin = '*'
  if allowed_origins.include?('*')
    cors_origin = '*'
  elsif origin && allowed_origins.any? { |pattern| origin.match?(/#{pattern.gsub('*', '.*')}/) }
    cors_origin = origin
  end
  
  headers 'Access-Control-Allow-Origin' => cors_origin
  headers 'Access-Control-Allow-Methods' => 'POST, GET, OPTIONS'
  headers 'Access-Control-Allow-Headers' => 'Content-Type, Origin, Accept'
  headers 'Access-Control-Max-Age' => '86400'
end

# Handle OPTIONS requests for CORS preflight
options '*' do
  status 204
  ''
end

# Helper function to set CORS headers
def set_cors_headers
  origin = request.env['HTTP_ORIGIN']
  allowed_origins = (ENV['ASCIIDOCTOR_ALLOW_ORIGIN'] || '*').split(',').map(&:strip).reject(&:empty?)
  
  cors_origin = '*'
  if allowed_origins.include?('*')
    cors_origin = '*'
  elsif origin && allowed_origins.any? { |pattern| origin.match?(/#{pattern.gsub('*', '.*')}/) }
    cors_origin = origin
  end
  
  headers 'Access-Control-Allow-Origin' => cors_origin
  headers 'Access-Control-Allow-Methods' => 'POST, GET, OPTIONS'
  headers 'Access-Control-Allow-Headers' => 'Content-Type, Origin, Accept'
  headers 'Access-Control-Max-Age' => '86400'
end

# Error handler to ensure CORS headers are always set, even on exceptions
error do
  set_cors_headers
  
  # Return error response
  content_type :json
  {
    error: 'Server error',
    message: env['sinatra.error'].message,
    class: env['sinatra.error'].class.name
  }.to_json
end


# Health check
get '/healthz' do
  content_type :json
  {
    name: 'wikistr-asciidoctor',
    status: 'ok',
    endpoints: {
      epub: '/convert/epub',
      html5: '/convert/html5',
      pdf: '/convert/pdf'
    },
    port: settings.port
  }.to_json
end

# REST API documentation
get '/api' do
  content_type :json
  {
    name: 'wikistr-asciidoctor',
    version: '1.0.0',
    description: 'AsciiDoctor REST API for converting AsciiDoc content to various formats. All formats support automatic table of contents generation and LaTeX math rendering via stem blocks (for display in HTML/EPUB).',
    base_url: "#{request.scheme}://#{request.host_with_port}/asciidoctor",
    endpoints: {
      health: {
        method: 'GET',
        path: '/asciidoctor/healthz',
        description: 'Health check endpoint',
        response: {
          type: 'application/json',
          schema: {
            name: 'string',
            status: 'string',
            endpoints: 'object',
            port: 'number'
          }
        }
      },
      convert_epub: {
        method: 'POST',
        path: '/asciidoctor/convert/epub',
        description: 'Convert AsciiDoc content to EPUB with automatic table of contents and LaTeX math support',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content. Supports LaTeX math via stem:[] for inline and [stem] blocks for display math',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author',
            theme: 'string (optional) - Theme for styling. Valid values: classic, antique, modern, documentation, scientific, pop, bible-paragraph, bible-versed, poster. Default: classic. Note: EPUB currently uses epub-classic.css for all themes.'
          }
        },
        response: {
          type: 'application/epub+zip',
          disposition: 'attachment'
        },
        features: {
          table_of_contents: 'Automatic table of contents is generated when :toc: attribute is set (enabled by default)',
          latex_math: 'LaTeX math expressions are supported via AsciiDoc stem blocks',
          diagrams: 'Diagram generation is supported via asciidoctor-diagram extension. Supported formats: PlantUML, Graphviz, Mermaid, BPMN (via PlantUML)'
        },
        example: {
          request: {
            content: '= My Book\n\nChapter 1 content.',
            title: 'My Book',
            author: 'Author Name',
            theme: 'classic'
          }
        }
      },
      convert_html5: {
        method: 'POST',
        path: '/asciidoctor/convert/html5',
        description: 'Convert AsciiDoc content to HTML5 with automatic table of contents and LaTeX math support',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content. Supports LaTeX math via stem:[] for inline and [stem] blocks for display math',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author'
          }
        },
        response: {
          type: 'text/html',
          disposition: 'attachment'
        },
        features: {
          table_of_contents: 'Automatic table of contents is generated when :toc: attribute is set (enabled by default)',
          latex_math: 'LaTeX math expressions are supported via AsciiDoc stem blocks',
          diagrams: 'Diagram generation is supported via asciidoctor-diagram extension. Supported formats: PlantUML, Graphviz, Mermaid, BPMN (via PlantUML)'
        }
      },
      convert_pdf: {
        method: 'POST',
        path: '/asciidoctor/convert/pdf',
        description: 'Convert AsciiDoc content to PDF with automatic table of contents and LaTeX math support',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content. Supports LaTeX math via stem:[] for inline and [stem] blocks for display math',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author'
          }
        },
        response: {
          type: 'application/pdf',
          disposition: 'attachment'
        },
        features: {
          table_of_contents: 'Automatic table of contents is generated when :toc: attribute is set (enabled by default)',
          latex_math: 'LaTeX math expressions are supported via AsciiDoc stem blocks',
          diagrams: 'Diagram generation is supported via asciidoctor-diagram extension. Supported formats: PlantUML, Graphviz, Mermaid, BPMN (via PlantUML)'
        }
      },
    },
    cors: {
      enabled: true,
      allowed_origins: ENV['ASCIIDOCTOR_ALLOW_ORIGIN'] || '*',
      allowed_methods: ['POST', 'OPTIONS'],
      allowed_headers: ['Content-Type', 'Origin', 'Accept']
    },
    limits: {
      max_request_size: '50 MB',
      max_content_size: '50 MB',
      recommended_max: '20 MB',
      note: 'The server can handle documents up to 50MB. The Bible (~4MB) is well within limits. Very large documents may take longer to process.'
    },
    examples: {
      curl_epub: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/epub -H 'Content-Type: application/json' -d '{\"content\":\"= Test\\n\\nHello world\",\"title\":\"Test Document\",\"author\":\"Test Author\"}' --output document.epub",
      curl_html5: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/html5 -H 'Content-Type: application/json' -d '{\"content\":\"= Test\\n\\nHello world\",\"title\":\"Test Document\",\"author\":\"Test Author\"}' --output document.html",
      curl_pdf: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/pdf -H 'Content-Type: application/json' -d '{\"content\":\"= Test\\n\\nHello world\",\"title\":\"Test Document\",\"author\":\"Test Author\"}' --output document.pdf",
    }
  }.to_json
end

# Alias for /api
get '/docs' do
  redirect '/api', 301
end

# Helper function to log large request sizes
def log_request_size(content, endpoint)
  size_mb = content.bytesize / (1024.0 * 1024.0)
  if size_mb > 5
    puts "[#{endpoint}] Processing large request: #{size_mb.round(2)} MB"
  end
end


# Convert to EPUB
post '/convert/epub' do
  begin
    request.body.rewind
    body_content = request.body.read
    log_request_size(body_content, 'EPUB')
    data = JSON.parse(body_content)
    content = data['content'] || data['asciidoc']
    title = data['title'] || 'Document'
    author = data['author'] || ''
    
    unless content
      status 400
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary file for AsciiDoc content
    temp_adoc = Tempfile.new(['document', '.adoc'])
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary directory for EPUB output
    temp_dir = Dir.mktmpdir('epub-')
    epub_file = File.join(temp_dir, 'document.epub')
    
    begin
      # EPUB - always use classic stylesheet
      stylesheet_name = 'epub-classic.css'
      stylesheet_path = File.join('/app/deployment', stylesheet_name)
      
      # Verify stylesheet exists
      unless File.exist?(stylesheet_path)
        puts "[EPUB] Warning: Classic stylesheet not found, proceeding without custom stylesheet"
        stylesheet_name = nil
      else
        puts "[EPUB] Using stylesheet: #{stylesheet_name}"
      end
      
      # Build EPUB attributes
      epub_attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',
        'allow-uri-read' => '',  # Enable remote image downloading
        'toc' => '',  # Enable table of contents
        'stem' => ''  # Enable LaTeX math support
      }
      
      # Check for HTTP proxy environment variables and log them
      if ENV['HTTP_PROXY'] || ENV['http_proxy']
        proxy = ENV['HTTP_PROXY'] || ENV['http_proxy']
        puts "[EPUB] HTTP_PROXY environment variable set: #{proxy}"
      end
      if ENV['HTTPS_PROXY'] || ENV['https_proxy']
        proxy = ENV['HTTPS_PROXY'] || ENV['https_proxy']
        puts "[EPUB] HTTPS_PROXY environment variable set: #{proxy}"
      end
      if ENV['NO_PROXY'] || ENV['no_proxy']
        no_proxy = ENV['NO_PROXY'] || ENV['no_proxy']
        puts "[EPUB] NO_PROXY environment variable set: #{no_proxy}"
      end
      
      # Add stylesheet if available
      stylesheet_attempted = false
      if stylesheet_name && File.exist?(stylesheet_path)
        epub_attributes['epub3-stylesdir'] = '/app/deployment'
        epub_attributes['stylesheet'] = stylesheet_name
        stylesheet_attempted = true
      end
      
      # Scan content for images before conversion and download remote images
      # First, scan for image macros (image:: and image:)
      image_urls = content.scan(/image::?([^\s\[\]]+)/i).flatten
      
      # Also scan for cover image attributes (:front-cover-image: and :epub-cover-image:)
      cover_image_attrs = content.scan(/^:(?:front-cover-image|epub-cover-image):\s*(.+)$/i).flatten
      cover_image_urls = cover_image_attrs.map { |attr| attr.strip }.reject(&:empty?)
      
      # Combine all image URLs (remove duplicates)
      all_image_urls = (image_urls + cover_image_urls).uniq
      downloaded_images = {}  # Map remote URLs to local filenames
      
      if all_image_urls.any?
        puts "[EPUB] Found #{all_image_urls.length} image reference(s) in content (#{image_urls.length} from macros, #{cover_image_urls.length} from cover attributes):"
        
        # Create images directory in temp location (use absolute path)
        temp_dir = File.dirname(temp_adoc.path)
        images_dir = File.join(temp_dir, 'images')
        FileUtils.mkdir_p(images_dir)
        # Use absolute path for imagesdir to avoid path resolution issues
        epub_attributes['imagesdir'] = File.expand_path(images_dir)
        puts "[EPUB] Images directory set to: #{epub_attributes['imagesdir']}"
        
        all_image_urls.each_with_index do |url, idx|
          puts "[EPUB]   Image #{idx + 1}: #{url}"
          # Check if it's a remote URL and download it
          if url.match?(/^https?:\/\//)
            puts "[EPUB]     -> Remote URL detected, downloading..."
            begin
              require 'open-uri'
              require 'uri'
              
              # Extract filename from URL
              uri = URI.parse(url)
              filename = File.basename(uri.path)
              # If no filename, generate one based on URL hash
              if filename.empty? || !filename.match?(/\.(jpg|jpeg|png|gif|svg|webp)$/i)
                # Try to determine extension from Content-Type or default to jpg
                filename = "image_#{url.hash.abs}.jpg"
              end
              
              local_path = File.join(images_dir, filename)
              
              # Download the image
              puts "[EPUB]     -> Downloading to: #{local_path}"
              URI.open(url, 'rb') do |remote_file|
                File.open(local_path, 'wb') do |local_file|
                  local_file.write(remote_file.read)
                end
              end
              
              puts "[EPUB]     -> Successfully downloaded (#{File.size(local_path)} bytes)"
              
              # Store mapping for content replacement
              downloaded_images[url] = filename
            rescue => download_error
              puts "[EPUB]     -> WARNING: Failed to download image: #{download_error.message}"
              puts "[EPUB]     -> Will rely on allow-uri-read for EPUB converter"
            end
          else
            puts "[EPUB]     -> Local path"
          end
        end
        
        # Replace remote URLs in content with local filenames
        if downloaded_images.any?
          puts "[EPUB] Replacing remote image URLs with local paths in content"
          downloaded_images.each do |remote_url, local_filename|
            # Replace both image:: and image: macros, preserving any attributes
            # Match: image::URL or image:URL followed by optional [attributes]
            # We need to capture the attributes if present
            old_content = content.dup
            # Pattern: image:: or image: followed by the URL, optionally followed by [attributes]
            content = content.gsub(/image::?#{Regexp.escape(remote_url)}(\[[^\]]*\])?/i) do |match|
              # Extract attributes if present
              attributes = $1 || ''
              "image::#{local_filename}#{attributes}"
            end
            if content != old_content
              puts "[EPUB]   Replaced image macro: #{remote_url} -> #{local_filename}"
            end
            
            # Also replace in epub-cover-image attribute (use relative path from docdir)
            # Since imagesdir is set to images_dir and docdir is the parent, use relative path
            old_content = content.dup
            # Get relative path from docdir (which is File.dirname(temp_adoc.path)) to images_dir
            docdir = File.dirname(temp_adoc.path)
            relative_image_path = Pathname.new(File.join(images_dir, local_filename)).relative_path_from(Pathname.new(docdir)).to_s
            content = content.gsub(/^:epub-cover-image:\s*#{Regexp.escape(remote_url)}\s*$/i, ":epub-cover-image: #{relative_image_path}")
            if content != old_content
              puts "[EPUB]   Replaced epub-cover-image attribute: #{remote_url} -> #{relative_image_path}"
            end
            
            # Also replace in front-cover-image attribute (use relative path from docdir)
            old_content = content.dup
            content = content.gsub(/^:front-cover-image:\s*#{Regexp.escape(remote_url)}\s*$/i, ":front-cover-image: #{relative_image_path}")
            if content != old_content
              puts "[EPUB]   Replaced front-cover-image attribute: #{remote_url} -> #{relative_image_path}"
            end
            
            # Also replace in title-logo-image attribute (if it contains the URL)
            old_content = content.dup
            content = content.gsub(/^:title-logo-image:.*#{Regexp.escape(remote_url)}/i) do |match|
              match.gsub(remote_url, local_filename)
            end
            if content != old_content
              puts "[EPUB]   Replaced title-logo-image attribute: #{remote_url} -> #{local_filename}"
            end
          end
          
          # Write updated content back to temp file
          File.write(temp_adoc.path, content)
          puts "[EPUB] Updated AsciiDoc file with local image paths"
        end
      else
        puts "[EPUB] No image references found in content"
      end
      
      # Check for epub-cover-image attribute
      if content.match(/^:epub-cover-image:\s*(.+)$/i)
        cover_image = $1.strip
        puts "[EPUB] EPUB cover image attribute found: #{cover_image}"
      end
      
      # Convert to EPUB using convert_file with to_file
      # This is the recommended approach for EPUB3
      puts "[EPUB] Starting conversion: #{temp_adoc.path} -> #{epub_file}"
      puts "[EPUB] Attributes: #{epub_attributes.inspect}"
      puts "[EPUB] allow-uri-read is #{epub_attributes['allow-uri-read'] ? 'ENABLED' : 'DISABLED'}"
      
      # Create a treeprocessor extension to log image processing
      image_processor = Class.new(Asciidoctor::Extensions::Treeprocessor) do
        def process(document)
          images = document.find_by(context: :image)
          if images.any?
            puts "[EPUB] Found #{images.length} image node(s) in document tree:"
            images.each_with_index do |image, idx|
              image_target = image.attr('target') || image.target
              puts "[EPUB]   Image node #{idx + 1}: target=#{image_target}, alt=#{image.attr('alt')}, role=#{image.attr('role')}"
              if image_target.match?(/^https?:\/\//)
                puts "[EPUB]     -> Remote URL detected"
              end
            end
          else
            puts "[EPUB] No image nodes found in document tree"
          end
          nil
        end
      end
      
      conversion_succeeded = false
      begin
        # Create extension registry with image logging
        extension_registry = Asciidoctor::Extensions.create do
          treeprocessor image_processor
        end
        
        result = Asciidoctor.convert_file(
          temp_adoc.path,
          backend: 'epub3',
          safe: 'unsafe',
          to_file: epub_file,
          attributes: epub_attributes,
          extension_registry: extension_registry
        )
        puts "[EPUB] Conversion completed, result: #{result.inspect}"
        
        # Check if EPUB file was created and its size
        if File.exist?(epub_file)
          epub_size = File.size(epub_file)
          puts "[EPUB] EPUB file created: #{epub_file}, size: #{epub_size} bytes"
          
          # Try to inspect EPUB contents for images (EPUB is a ZIP file)
          begin
            require 'zip'
            image_files = []
            Zip::File.open(epub_file) do |zip_file|
              zip_file.each do |entry|
                if entry.name.match?(/\.(jpg|jpeg|png|gif|svg|webp)$/i)
                  image_files << entry.name
                  puts "[EPUB] Found image in EPUB: #{entry.name} (#{entry.size} bytes)"
                end
              end
            end
            if image_files.empty?
              puts "[EPUB] WARNING: No image files found in EPUB archive"
            else
              puts "[EPUB] Total images embedded in EPUB: #{image_files.length}"
            end
          rescue => zip_error
            puts "[EPUB] Could not inspect EPUB contents: #{zip_error.message}"
          end
        else
          puts "[EPUB] ERROR: EPUB file was not created at #{epub_file}"
        end
        
        conversion_succeeded = true
      rescue => e
        puts "[EPUB] Conversion error: #{e.class.name}: #{e.message}"
        puts "[EPUB] Backtrace: #{e.backtrace.first(5).join("\n")}"
        
        # If this is a stylesheet error and we tried to use a stylesheet, retry without it
        if stylesheet_attempted && (e.message.include?('stylesheet') || e.message.include?('css') || e.message.include?('style'))
          puts "[EPUB] Stylesheet error detected, retrying without custom stylesheet"
          # Remove stylesheet attributes and retry
          retry_attributes = epub_attributes.dup
          retry_attributes.delete('epub3-stylesdir')
          retry_attributes.delete('stylesheet')
          
          begin
            result = Asciidoctor.convert_file(
              temp_adoc.path,
              backend: 'epub3',
              safe: 'unsafe',
              to_file: epub_file,
              attributes: retry_attributes
            )
            puts "[EPUB] Conversion completed without stylesheet, result: #{result.inspect}"
            conversion_succeeded = true
          rescue => retry_error
            puts "[EPUB] Retry also failed: #{retry_error.class.name}: #{retry_error.message}"
            # Fall through to error handling below
            e = retry_error
          end
        end
        
        # If conversion still failed, return error
        unless conversion_succeeded
          error_details = {
            error: 'EPUB conversion failed',
            message: e.message,
            class: e.class.name
          }
          
          # Add helpful hints based on error type
          if e.message.include?('syntax') || e.message.include?('parse') || e.message.include?('invalid')
            error_details[:hint] = 'This appears to be an AsciiDoc syntax error. Please check your document for: unclosed blocks, invalid attribute syntax, or malformed headings.'
          end
          
          # Include line number if available
          if e.message.match(/line\s+(\d+)/i)
            line_num = e.message.match(/line\s+(\d+)/i)[1]
            error_details[:line] = line_num.to_i
            error_details[:hint] = "Error detected around line #{line_num}. Please check the AsciiDoc syntax at that location."
          end
          
          status 500
          return error_details.to_json
        end
      end
      
      # Check if EPUB file was created
      unless File.exist?(epub_file)
        puts "[EPUB] Error: EPUB file was not created at #{epub_file}"
        status 500
        return { 
          error: 'EPUB file was not created', 
          debug: "Expected file: #{epub_file}",
          hint: 'The conversion completed but no EPUB file was generated. Check server logs for details.'
        }.to_json
      end
      
      # Check file size
      file_size = File.size(epub_file)
      puts "[EPUB] File created: #{epub_file}, size: #{file_size} bytes"
      
      if file_size == 0
        status 500
        return { error: 'Generated EPUB file is empty' }.to_json
      end
      
      # Basic validation: Check for ZIP magic bytes (EPUB is a ZIP archive)
      begin
        File.open(epub_file, 'rb') do |f|
          magic = f.read(4)
          unless magic == "PK\x03\x04"
            puts "[EPUB] Error: Invalid ZIP magic bytes: #{magic.unpack('H*').first}"
            status 500
            return { 
              error: 'Generated file is not a valid ZIP/EPUB', 
              magic: magic.unpack('H*').first,
              hint: 'The file was created but does not appear to be a valid EPUB (ZIP) file.'
            }.to_json
          end
        end
      rescue => e
        puts "[EPUB] Error validating ZIP structure: #{e.message}"
        status 500
        return { 
          error: 'Failed to validate EPUB file', 
          message: e.message 
        }.to_json
      end
      
      # Read EPUB content as binary
      epub_content = File.binread(epub_file)
      
      if epub_content.nil? || epub_content.empty?
        status 500
        return { error: 'Generated EPUB file is empty after reading' }.to_json
      end
      
      puts "[EPUB] Successfully generated EPUB: #{epub_content.bytesize} bytes"
      
      # Set headers and return binary content
      content_type 'application/epub+zip'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.epub\""
      headers 'Content-Length' => epub_content.bytesize.to_s
      
      epub_content
    ensure
      # Cleanup
      temp_adoc.unlink if temp_adoc
      FileUtils.rm_rf(temp_dir) if temp_dir && Dir.exist?(temp_dir)
    end
  rescue JSON::ParserError => e
    status 400
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    puts "[EPUB] Unexpected error: #{e.class.name}: #{e.message}"
    puts "[EPUB] Backtrace: #{e.backtrace.first(10).join("\n")}"
    
    error_details = {
      error: 'EPUB conversion failed',
      message: e.message,
      class: e.class.name
    }
    
    # Add helpful hints
    if e.message.include?('syntax') || e.message.include?('parse') || e.message.include?('invalid') || e.message.include?('AsciiDoc')
      error_details[:hint] = 'This appears to be an AsciiDoc syntax error. Common issues include: unclosed blocks (----), invalid attribute syntax, malformed headings, or incorrect attribute block spacing.'
    end
    
    # Include backtrace for debugging (first few lines only)
    if e.backtrace && e.backtrace.length > 0
      error_details[:backtrace] = e.backtrace.first(5)
    end
    
    status 500
    error_details.to_json
  end
end

# Convert to HTML5
post '/convert/html5' do
  begin
    request.body.rewind
    body_content = request.body.read
    log_request_size(body_content, 'HTML5')
    data = JSON.parse(body_content)
    content = data['content'] || data['asciidoc']
    title = data['title'] || 'Document'
    author = data['author'] || ''
    
    unless content
      status 400
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary file for AsciiDoc content
    temp_adoc = Tempfile.new(['document', '.adoc'])
    temp_adoc.write(content)
    temp_adoc.close
    
    begin
      # Convert to HTML5 with standalone document
      html_content = Asciidoctor.convert content,
        backend: 'html5',
        safe: 'unsafe',
        attributes: {
          'title' => title,
          'author' => author,
          'doctype' => 'article',
          'imagesdir' => '.',
          'allow-uri-read' => '',
          'stylesheet' => 'default',
          'linkcss' => '',
          'copycss' => '',
          'standalone' => '',
          'noheader' => '',
          'nofooter' => ''
        }
      
      # Ensure we have a complete HTML document
      unless html_content.include?('<!doctype') || html_content.include?('<!DOCTYPE')
        html_content = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>#{title}</title>\n</head>\n<body>\n#{html_content}\n</body>\n</html>"
      end
      
      # Inject custom CSS to prevent source blocks and verbatim elements from overflowing
      source_block_css = <<~CSS
        <style>
          /* Prevent horizontal overflow on body and containers */
          body {
            max-width: 100%;
            overflow-x: auto;
            box-sizing: border-box;
          }
          
          /* All code and source blocks */
          pre, pre code, .listingblock pre, .literalblock pre, .sourceblock pre {
            max-width: 100%;
            overflow-x: auto;
            overflow-wrap: break-word;
            word-wrap: break-word;
            box-sizing: border-box;
          }
          
          /* Ensure code blocks scroll instead of overflow */
          pre code {
            display: block;
            max-width: 100%;
            overflow-x: auto;
          }
          
          /* Blockquotes and quotes - can contain long lines */
          blockquote, .quoteblock, .quote-block {
            max-width: 100%;
            overflow-x: auto;
            overflow-wrap: break-word;
            word-wrap: break-word;
            box-sizing: border-box;
          }
          
          blockquote p, .quoteblock p, .quote-block p,
          blockquote div, .quoteblock div, .quote-block div {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          /* Verse blocks (poetry) */
          .verseblock, .verse-block {
            max-width: 100%;
            overflow-x: auto;
            overflow-wrap: break-word;
            word-wrap: break-word;
            box-sizing: border-box;
          }
          
          .verseblock pre, .verse-block pre {
            max-width: 100%;
            overflow-x: auto;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          /* Any element with pre-formatted content */
          [class*="literal"], [class*="listing"], [class*="source"] {
            max-width: 100%;
            overflow-x: auto;
            box-sizing: border-box;
          }
          
          /* Tables - can also get wide */
          table {
            max-width: 100%;
            overflow-x: auto;
            display: block;
            box-sizing: border-box;
          }
          
          /* Container constraints */
          .content, #content, [role="main"], main, article, section {
            max-width: 100%;
            overflow-x: auto;
            box-sizing: border-box;
          }
          
          /* Ensure inline code doesn't break layout */
          code:not(pre code) {
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
        </style>
      CSS
      
      # Inject CSS into <head> if it exists, otherwise before </body>
      if html_content.include?('</head>')
        html_content = html_content.sub('</head>', "#{source_block_css}</head>")
      elsif html_content.include?('</body>')
        html_content = html_content.sub('</body>', "#{source_block_css}</body>")
      else
        # If no head or body, prepend to content
        html_content = source_block_css + html_content
      end
      
      # Set headers
      content_type 'text/html; charset=utf-8'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.html\""
      
      html_content
    ensure
      temp_adoc.unlink
    end
  rescue JSON::ParserError => e
    status 400
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    status 500
    { error: 'Conversion failed', message: e.message }.to_json
  end
end

# Convert to PDF
post '/convert/pdf' do
  begin
    request.body.rewind
    body_content = request.body.read
    log_request_size(body_content, 'PDF')
    data = JSON.parse(body_content)
    content = data['content'] || data['asciidoc']
    title = data['title'] || 'Document'
    author = data['author'] || ''
    
    unless content
      status 400
      content_type :json
      set_cors_headers
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary file for AsciiDoc content
    temp_adoc = Tempfile.new(['document', '.adoc'])
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary file for PDF output
    temp_pdf = Tempfile.new(['document', '.pdf'])
    temp_pdf.close
    
    begin
      # Build PDF attributes
      pdf_attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',
        'allow-uri-read' => '',  # Enable remote image downloading
        'toc' => '',  # Enable table of contents
        'stem' => ''  # Enable LaTeX math support
      }
      
      # Scan content for images before conversion and download remote images
      # First, scan for image macros (image:: and image:)
      image_urls = content.scan(/image::?([^\s\[\]]+)/i).flatten
      
      # Also scan for cover image attributes (:front-cover-image: and :epub-cover-image:)
      cover_image_attrs = content.scan(/^:(?:front-cover-image|epub-cover-image):\s*(.+)$/i).flatten
      cover_image_urls = cover_image_attrs.map { |attr| attr.strip }.reject(&:empty?)
      
      # Combine all image URLs (remove duplicates)
      all_image_urls = (image_urls + cover_image_urls).uniq
      downloaded_images = {}  # Map remote URLs to local filenames
      
      if all_image_urls.any?
        puts "[PDF] Found #{all_image_urls.length} image reference(s) in content (#{image_urls.length} from macros, #{cover_image_urls.length} from cover attributes):"
        
        # Create images directory in temp location (use absolute path)
        temp_dir = File.dirname(temp_adoc.path)
        images_dir = File.join(temp_dir, 'images')
        FileUtils.mkdir_p(images_dir)
        # Use absolute path for imagesdir to avoid path resolution issues
        pdf_attributes['imagesdir'] = File.expand_path(images_dir)
        puts "[PDF] Images directory set to: #{pdf_attributes['imagesdir']}"
        
        all_image_urls.each_with_index do |url, idx|
          puts "[PDF]   Image #{idx + 1}: #{url}"
          # Check if it's a remote URL and download it
          if url.match?(/^https?:\/\//)
            puts "[PDF]     -> Remote URL detected, downloading..."
            begin
              require 'open-uri'
              require 'uri'
              
              # Extract filename from URL
              uri = URI.parse(url)
              filename = File.basename(uri.path)
              # If no filename, generate one based on URL hash
              if filename.empty? || !filename.match?(/\.(jpg|jpeg|png|gif|svg|webp)$/i)
                # Try to determine extension from Content-Type or default to jpg
                filename = "image_#{url.hash.abs}.jpg"
              end
              
              local_path = File.join(images_dir, filename)
              
              # Download the image
              puts "[PDF]     -> Downloading to: #{local_path}"
              URI.open(url, 'rb') do |remote_file|
                File.open(local_path, 'wb') do |local_file|
                  local_file.write(remote_file.read)
                end
              end
              
              puts "[PDF]     -> Successfully downloaded (#{File.size(local_path)} bytes)"
              
              # Store mapping for content replacement
              downloaded_images[url] = filename
            rescue => download_error
              puts "[PDF]     -> WARNING: Failed to download image: #{download_error.message}"
              puts "[PDF]     -> Will rely on allow-uri-read for PDF converter"
            end
          else
            puts "[PDF]     -> Local path"
          end
        end
        
        # Replace remote URLs in content with local filenames
        if downloaded_images.any?
          puts "[PDF] Replacing remote image URLs with local paths in content"
          downloaded_images.each do |remote_url, local_filename|
            # Replace both image:: and image: macros, preserving any attributes
            old_content = content.dup
            content = content.gsub(/image::?#{Regexp.escape(remote_url)}(\[[^\]]*\])?/i) do |match|
              attributes = $1 || ''
              "image::#{local_filename}#{attributes}"
            end
            if content != old_content
              puts "[PDF]   Replaced image macro: #{remote_url} -> #{local_filename}"
            end
            
            # Also replace in front-cover-image attribute (use relative path from docdir)
            docdir = File.dirname(temp_adoc.path)
            relative_image_path = Pathname.new(File.join(images_dir, local_filename)).relative_path_from(Pathname.new(docdir)).to_s
            old_content = content.dup
            content = content.gsub(/^:front-cover-image:\s*#{Regexp.escape(remote_url)}\s*$/i, ":front-cover-image: #{relative_image_path}")
            if content != old_content
              puts "[PDF]   Replaced front-cover-image attribute: #{remote_url} -> #{relative_image_path}"
            end
            
            # Also replace in epub-cover-image attribute if present
            old_content = content.dup
            content = content.gsub(/^:epub-cover-image:\s*#{Regexp.escape(remote_url)}\s*$/i, ":epub-cover-image: #{relative_image_path}")
            if content != old_content
              puts "[PDF]   Replaced epub-cover-image attribute: #{remote_url} -> #{relative_image_path}"
            end
            
            # Also replace in title-logo-image attribute (if it contains the URL)
            old_content = content.dup
            content = content.gsub(/^:title-logo-image:.*#{Regexp.escape(remote_url)}/i) do |match|
              match.gsub(remote_url, local_filename)
            end
            if content != old_content
              puts "[PDF]   Replaced title-logo-image attribute: #{remote_url} -> #{local_filename}"
            end
          end
          
          # Write updated content back to temp file
          File.write(temp_adoc.path, content)
          puts "[PDF] Updated AsciiDoc file with local image paths"
        end
      else
        puts "[PDF] No image references found in content"
      end
      
      puts "[PDF] Starting conversion: #{temp_adoc.path} -> #{temp_pdf.path}"
      puts "[PDF] Attributes: #{pdf_attributes.inspect}"
      puts "[PDF] Content size: #{content.bytesize} bytes"
      start_time = Time.now
      
      # Convert to PDF using convert_file with to_file
      result = Asciidoctor.convert_file(
        temp_adoc.path,
        backend: 'pdf',
        safe: 'unsafe',
        to_file: temp_pdf.path,
        attributes: pdf_attributes
      )
      elapsed_time = Time.now - start_time
      puts "[PDF] Conversion completed in #{elapsed_time.round(2)} seconds, result: #{result.inspect}"
      
      # Check if PDF file was created
      unless File.exist?(temp_pdf.path)
        puts "[PDF] Error: PDF file was not created at #{temp_pdf.path}"
        status 500
        content_type :json
        set_cors_headers
        return { 
          error: 'PDF file was not created', 
          debug: "Expected file: #{temp_pdf.path}",
          hint: 'The conversion completed but no PDF file was generated. Check server logs for details.'
        }.to_json
      end
      
      # Check file size
      file_size = File.size(temp_pdf.path)
      puts "[PDF] File created: #{temp_pdf.path}, size: #{file_size} bytes"
      
      if file_size == 0
        status 500
        content_type :json
        set_cors_headers
        return { error: 'Generated PDF file is empty' }.to_json
      end
      
      # Basic validation: Check for PDF magic bytes (%PDF)
      begin
        File.open(temp_pdf.path, 'rb') do |f|
          magic = f.read(4)
          unless magic == "%PDF"
            puts "[PDF] Error: Invalid PDF magic bytes: #{magic.unpack('H*').first}"
            status 500
            content_type :json
            set_cors_headers
            return { 
              error: 'Generated file is not a valid PDF', 
              magic: magic.unpack('H*').first,
              hint: 'The file was created but does not appear to be a valid PDF file.'
            }.to_json
          end
        end
      rescue => e
        puts "[PDF] Error validating PDF structure: #{e.message}"
        status 500
        content_type :json
        set_cors_headers
        return { 
          error: 'Failed to validate PDF file', 
          message: e.message 
        }.to_json
      end
      
      # Read PDF content as binary
      pdf_content = File.binread(temp_pdf.path)
      
      if pdf_content.nil? || pdf_content.empty?
        status 500
        content_type :json
        set_cors_headers
        return { error: 'Generated PDF file is empty after reading' }.to_json
      end
      
      puts "[PDF] Successfully generated PDF: #{pdf_content.bytesize} bytes"
      puts "[PDF] Sending PDF response to client..."
      
      # Set headers and return binary content
      content_type 'application/pdf'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.pdf\""
      headers 'Content-Length' => pdf_content.bytesize.to_s
      set_cors_headers  # Ensure CORS headers are set for successful responses too
      
      puts "[PDF] Headers set, returning PDF content..."
      pdf_content
    ensure
      # Cleanup
      temp_adoc.unlink if temp_adoc
      temp_pdf.unlink if temp_pdf
    end
  rescue JSON::ParserError => e
    status 400
    content_type :json
    set_cors_headers
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    puts "[PDF] Unexpected error: #{e.class.name}: #{e.message}"
    puts "[PDF] Backtrace: #{e.backtrace.first(10).join("\n")}"
    
    error_details = {
      error: 'PDF conversion failed',
      message: e.message,
      class: e.class.name
    }
    
    # Add helpful hints
    if e.message.include?('syntax') || e.message.include?('parse') || e.message.include?('invalid') || e.message.include?('AsciiDoc')
      error_details[:hint] = 'This appears to be an AsciiDoc syntax error. Common issues include: unclosed blocks (----), invalid attribute syntax, malformed headings, or incorrect attribute block spacing.'
    end
    
    # Include backtrace for debugging (first few lines only)
    if e.backtrace && e.backtrace.length > 0
      error_details[:backtrace] = e.backtrace.first(5)
    end
    
    status 500
    content_type :json
    set_cors_headers
    error_details.to_json
  end
end

# Root endpoint
get '/' do
  content_type :json
  {
    name: 'wikistr-asciidoctor',
    status: 'ok',
    version: '1.0.0',
    message: 'Visit /api for REST API documentation',
    endpoints: {
      epub: '/convert/epub',
      html5: '/convert/html5',
      pdf: '/convert/pdf',
      health: '/healthz',
      api_docs: '/api'
    }
  }.to_json
end


