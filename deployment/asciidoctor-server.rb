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
require 'timeout'

# Set port and bind - use environment variable or default to 8091
set :port, ENV.fetch('ASCIIDOCTOR_PORT', 8091).to_i
set :bind, '0.0.0.0'  # Bind to all interfaces so it can be accessed from Docker network
set :server, 'puma'
set :protection, false  # Disable CSRF protection for API (not needed for REST API)
set :public_folder, false  # Disable static file serving - this is a REST API only
set :static, false  # Explicitly disable static file serving to prevent getcwd errors

# Ensure working directory is always valid
# This prevents getcwd errors when temp directories are cleaned up
begin
  # Get the script's directory as a safe fallback
  script_dir = __dir__ || File.dirname(__FILE__)
  # Ensure we're in a valid directory
  Dir.chdir(script_dir) if File.directory?(script_dir)
rescue => e
  puts "Warning: Could not set working directory: #{e.message}"
  # Try to use /tmp as a last resort
  Dir.chdir('/tmp') if File.directory?('/tmp')
end

# Conversion timeout in seconds (default: 10 minutes for large books)
# Can be overridden with ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable
CONVERSION_TIMEOUT = ENV.fetch('ASCIIDOCTOR_CONVERSION_TIMEOUT', 600).to_i  # 10 minutes default

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

# Ensure working directory is valid before each request
# This prevents getcwd errors when temp directories are cleaned up
before do
  # Ensure we're in a valid directory
  begin
    # Try to get current directory - if it fails, change to a safe location
    Dir.pwd
  rescue Errno::ENOENT => e
    # Current directory is invalid, change to script directory or /tmp
    script_dir = __dir__ || File.dirname(__FILE__) || '/app/deployment'
    if File.directory?(script_dir)
      Dir.chdir(script_dir)
      puts "Warning: Working directory was invalid, changed to: #{script_dir}"
    elsif File.directory?('/tmp')
      Dir.chdir('/tmp')
      puts "Warning: Working directory was invalid, changed to: /tmp"
    end
  end
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

# Helper function to get a safe temp directory
# Always returns /tmp to avoid getcwd errors
def safe_temp_dir
  '/tmp'
end

# Helper function to safely change directory before cleanup
# Prevents getcwd errors when temp directories are removed
def safe_chdir_before_cleanup
  begin
    script_dir = __dir__ || File.dirname(__FILE__) || '/app/deployment'
    if File.directory?(script_dir)
      Dir.chdir(script_dir)
    elsif File.directory?('/tmp')
      Dir.chdir('/tmp')
    end
  rescue => e
    # Ignore errors when changing directory - we'll still try to clean up
    puts "Warning: Could not change directory before cleanup: #{e.message}"
  end
end

# Helper function to create a temp file in a safe location
# Uses explicit /tmp directory to avoid getcwd errors
def safe_tempfile(prefix, suffix = '')
  # Ensure we have a valid working directory first
  begin
    Dir.pwd
  rescue Errno::ENOENT
    # Current directory is invalid, change to /tmp
    Dir.chdir('/tmp') if File.directory?('/tmp')
  end
  
  # Create temp file with explicit directory
  Tempfile.new([prefix, suffix], safe_temp_dir)
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
    puts "[EPUB] Request received at #{Time.now}"
    request.body.rewind
    puts "[EPUB] Reading request body..."
    body_content = request.body.read
    puts "[EPUB] Request body read, size: #{body_content.bytesize} bytes"
    log_request_size(body_content, 'EPUB')
    data = JSON.parse(body_content)
    content = data['content'] || data['asciidoc']
    title = data['title'] || 'Document'
    author = data['author'] || ''
    
    unless content
      status 400
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary file for AsciiDoc content in safe location
    temp_adoc = safe_tempfile('document', '.adoc')
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary directory for EPUB output in safe location
    temp_dir = Dir.mktmpdir('epub-', safe_temp_dir)
    epub_file = File.join(temp_dir, 'document.epub')
    
    begin
      # EPUB - always use classic stylesheet
      # Determine deployment directory dynamically (where this script is located)
      # Use __dir__ first, fallback to script location, then /app/deployment
      deployment_dir = __dir__ || File.dirname(__FILE__) || '/app/deployment'
      stylesheet_name = 'epub-classic.css'
      stylesheet_path = File.join(deployment_dir, stylesheet_name)
      
      # Verify stylesheet exists
      unless File.exist?(stylesheet_path)
        puts "[EPUB] Warning: Classic stylesheet not found at #{stylesheet_path}, proceeding without custom stylesheet"
        begin
          current_dir = Dir.pwd rescue 'unknown'
        rescue
          current_dir = 'unknown (getcwd failed)'
        end
        puts "[EPUB] Debug: Current directory: #{current_dir}, Script directory: #{__dir__ || File.dirname(__FILE__)}"
        stylesheet_name = nil
      else
        puts "[EPUB] Using stylesheet: #{stylesheet_path}"
      end
      
      # Build EPUB attributes
      epub_attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',
        'allow-uri-read' => '',  # Enable remote image downloading
        'toc' => '',  # Enable table of contents
        'stem' => '',  # Enable LaTeX math support
        'epub3-stylesheet' => ''  # Explicitly disable stylesheet to prevent gem from looking for default CSS
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
      # IMPORTANT: Only set stylesheet attributes if we have a custom stylesheet
      # If we don't set these, the gem will use its built-in defaults without trying
      # to access external CSS files that might not exist in the container
      stylesheet_attempted = false
      if stylesheet_name && File.exist?(stylesheet_path)
        # Use the deployment directory where the stylesheet was found
        epub_attributes['epub3-stylesdir'] = deployment_dir
        epub_attributes['stylesheet'] = stylesheet_name
        stylesheet_attempted = true
        puts "[EPUB] Using custom stylesheet: #{stylesheet_name}"
      else
        # Don't set any stylesheet attributes - let the gem use its built-in defaults
        # This avoids errors when the gem's data files aren't accessible
        puts "[EPUB] No custom stylesheet found, using gem's built-in defaults"
      end
      
      # Scan content for images before conversion and download remote images
      # First, scan for image macros (image:: and image:)
      # Pattern matches: image::url or image:url, optionally followed by [attributes]
      image_urls = content.scan(/image::?([^\s\[\]]+)/i).flatten
      
      # Also scan for inline image macros with attributes: image::url[alt] or image:url[alt]
      # This catches cases where URLs might have been missed
      inline_images = content.scan(/image::?([^\[]+)\[/i).flatten.map { |url| url.strip }
      image_urls = (image_urls + inline_images).uniq
      
      # Also scan for cover image attributes (:front-cover-image: and :epub-cover-image:)
      cover_image_attrs = content.scan(/^:(?:front-cover-image|epub-cover-image):\s*(.+)$/i).flatten
      cover_image_urls = cover_image_attrs.map { |attr| attr.strip }.reject(&:empty?)
      
      # Combine all image URLs (remove duplicates)
      all_image_urls = (image_urls + cover_image_urls).uniq
      downloaded_images = {}  # Map remote URLs to local filenames
      
      # Debug: Log all found image URLs
      if all_image_urls.any?
        puts "[EPUB] Found #{all_image_urls.length} image reference(s) in content (#{image_urls.length} from macros, #{cover_image_urls.length} from cover attributes):"
        puts "[EPUB] Debug: All image URLs: #{all_image_urls.inspect}"
        
        # Create images directory in temp location (use absolute path)
        temp_dir = File.dirname(temp_adoc.path)
        images_dir = File.join(temp_dir, 'images')
        FileUtils.mkdir_p(images_dir)
        # Use relative path for imagesdir (relative to document directory)
        # Asciidoctor resolves imagesdir relative to the document's directory
        epub_attributes['imagesdir'] = 'images'
        puts "[EPUB] Images directory set to: #{epub_attributes['imagesdir']} (absolute: #{File.expand_path(images_dir)})"
        
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
        # Debug: Check if there are any image macros in content that weren't detected
        image_macro_count = content.scan(/image::?/i).length
        if image_macro_count > 0
          puts "[EPUB] WARNING: Found #{image_macro_count} image macro(s) in content but extracted 0 URLs"
          puts "[EPUB] Debug: Sample of content with images: #{content.scan(/image::?[^\n]{0,100}/i).first(3).inspect}"
        else
          puts "[EPUB] No image references found in content"
        end
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
      puts "[EPUB] Conversion timeout: #{CONVERSION_TIMEOUT} seconds"
      
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
        
        # Try conversion - if it fails due to stylesheet issues, we'll retry without stylesheet
        begin
          # Wrap conversion in timeout to prevent stuck conversions
          result = Timeout.timeout(CONVERSION_TIMEOUT) do
            Asciidoctor.convert_file(
              temp_adoc.path,
              backend: 'epub3',
              safe: 'unsafe',
              to_file: epub_file,
              attributes: epub_attributes,
              extension_registry: extension_registry
            )
          end
          puts "[EPUB] Conversion completed, result: #{result.inspect}"
          # Check if file was created before setting conversion_succeeded
        rescue => initial_error
          # Check if this is a stylesheet error before the main error handler
          is_stylesheet_error = initial_error.message.include?('stylesheet') || 
                                initial_error.message.include?('css') || 
                                initial_error.message.include?('style') ||
                                initial_error.message.include?('epub3.css') ||
                                initial_error.message.include?('No such file or directory') ||
                                (initial_error.message.include?('rb_sysopen') && initial_error.message.include?('.css'))
          
          if is_stylesheet_error
            puts "[EPUB] Initial conversion failed with stylesheet error, retrying without stylesheet..."
            # Remove all stylesheet-related attributes
            retry_attributes = epub_attributes.dup
            retry_attributes.delete('epub3-stylesdir')
            retry_attributes.delete('stylesheet')
            retry_attributes.delete('epub3-stylesheet')
            
            # Try again without any stylesheet configuration
            result = Timeout.timeout(CONVERSION_TIMEOUT) do
              Asciidoctor.convert_file(
                temp_adoc.path,
                backend: 'epub3',
                safe: 'unsafe',
                to_file: epub_file,
                attributes: retry_attributes,
                extension_registry: extension_registry
              )
            end
            puts "[EPUB] Conversion completed without stylesheet, result: #{result.inspect}"
            # Don't set conversion_succeeded here - check if file exists first
          else
            # Not a stylesheet error, re-raise for main error handler
            raise initial_error
          end
        end
        
        # Check if EPUB file was created and its size
        if File.exist?(epub_file) && File.size(epub_file) > 0
          epub_size = File.size(epub_file)
          puts "[EPUB] EPUB file created: #{epub_file}, size: #{epub_size} bytes"
          conversion_succeeded = true
          
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
          puts "[EPUB] ERROR: EPUB file was not created at #{epub_file} or is empty"
          conversion_succeeded = false
        end
      rescue Timeout::Error => e
        puts "[EPUB] Conversion timed out after #{CONVERSION_TIMEOUT} seconds"
        error_details = {
          error: 'EPUB conversion timed out',
          message: "Conversion exceeded the maximum time limit of #{CONVERSION_TIMEOUT} seconds",
          hint: 'The document may be too large or complex. Try breaking it into smaller sections, or increase ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable.'
        }
        status 504  # Gateway Timeout
        content_type :json
        set_cors_headers
        return error_details.to_json
      rescue => e
        puts "[EPUB] Conversion error: #{e.class.name}: #{e.message}"
        puts "[EPUB] Backtrace: #{e.backtrace.first(10).join("\n")}"
        
        # If this is a stylesheet error (including gem's default CSS file not found), retry without stylesheet
        is_stylesheet_error = e.message.include?('stylesheet') || 
                              e.message.include?('css') || 
                              e.message.include?('style') ||
                              e.message.include?('epub3.css') ||
                              e.message.include?('No such file or directory') ||
                              (e.message.include?('rb_sysopen') && e.message.include?('.css')) ||
                              e.message.include?('ENOENT')
        
        if is_stylesheet_error && !conversion_succeeded
          puts "[EPUB] Stylesheet error detected (#{e.message}), retrying without any stylesheet configuration"
          # Remove all stylesheet-related attributes and retry
          retry_attributes = epub_attributes.dup
          retry_attributes.delete('epub3-stylesdir')
          retry_attributes.delete('stylesheet')
          retry_attributes.delete('epub3-stylesheet')
          
          # Also remove from content if present
          content_without_stylesheet = content.dup
          content_without_stylesheet.gsub!(/^:epub3-stylesheet:.*$/i, '')
          content_without_stylesheet.gsub!(/^:stylesheet:.*$/i, '')
          content_without_stylesheet.gsub!(/^:epub3-stylesdir:.*$/i, '')
          
          # Write updated content
          File.write(temp_adoc.path, content_without_stylesheet)
          
          begin
            puts "[EPUB] Retrying conversion with all stylesheet attributes removed"
            result = Timeout.timeout(CONVERSION_TIMEOUT) do
              Asciidoctor.convert_file(
                temp_adoc.path,
                backend: 'epub3',
                safe: 'unsafe',
                to_file: epub_file,
                attributes: retry_attributes
              )
            end
            puts "[EPUB] Conversion completed without stylesheet, result: #{result.inspect}"
            
            # Verify file was created
            if File.exist?(epub_file) && File.size(epub_file) > 0
              conversion_succeeded = true
            else
              puts "[EPUB] Retry completed but no EPUB file was created"
            end
          rescue Timeout::Error => retry_error
            puts "[EPUB] Retry conversion timed out after #{CONVERSION_TIMEOUT} seconds"
            error_details = {
              error: 'EPUB conversion timed out',
              message: "Conversion exceeded the maximum time limit of #{CONVERSION_TIMEOUT} seconds",
              hint: 'The document may be too large or complex. Try breaking it into smaller sections, or increase ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable.'
            }
            status 504  # Gateway Timeout
            content_type :json
            set_cors_headers
            return error_details.to_json
          rescue => retry_error
            puts "[EPUB] Retry also failed: #{retry_error.class.name}: #{retry_error.message}"
            puts "[EPUB] Retry backtrace: #{retry_error.backtrace.first(5).join("\n")}"
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
      # Cleanup - change out of temp directory before removing it to prevent getcwd errors
      safe_chdir_before_cleanup
      
      # Now safe to remove temp directory
      temp_adoc.unlink if temp_adoc
      FileUtils.rm_rf(temp_dir) if temp_dir && Dir.exist?(temp_dir)
    end
  rescue JSON::ParserError => e
    status 400
    content_type :json
    set_cors_headers
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue Timeout::Error => e
    puts "[EPUB] Conversion timed out after #{CONVERSION_TIMEOUT} seconds"
    error_details = {
      error: 'EPUB conversion timed out',
      message: "Conversion exceeded the maximum time limit of #{CONVERSION_TIMEOUT} seconds",
      hint: 'The document may be too large or complex. Try breaking it into smaller sections, or increase ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable.'
    }
    status 504  # Gateway Timeout
    content_type :json
    set_cors_headers
    error_details.to_json
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
    content_type :json
    set_cors_headers
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
    
    # Create temporary file for AsciiDoc content in safe location
    temp_adoc = safe_tempfile('document', '.adoc')
    temp_adoc.write(content)
    temp_adoc.close
    
    begin
      # Scan content for images before conversion and download remote images
      # First, scan for image macros (image:: and image:)
      image_urls = content.scan(/image::?([^\s\[\]]+)/i).flatten
      
      # Also scan for inline image macros with attributes
      inline_images = content.scan(/image::?([^\[]+)\[/i).flatten.map { |url| url.strip }
      image_urls = (image_urls + inline_images).uniq
      
      # Also scan for cover image attributes
      cover_image_attrs = content.scan(/^:(?:front-cover-image|epub-cover-image):\s*(.+)$/i).flatten
      cover_image_urls = cover_image_attrs.map { |attr| attr.strip }.reject(&:empty?)
      
      # Combine all image URLs
      all_image_urls = (image_urls + cover_image_urls).uniq
      downloaded_images = {}
      
      if all_image_urls.any?
        puts "[HTML5] Found #{all_image_urls.length} image reference(s) in content"
        
        # Create images directory
        temp_dir = File.dirname(temp_adoc.path)
        images_dir = File.join(temp_dir, 'images')
        FileUtils.mkdir_p(images_dir)
        
        all_image_urls.each_with_index do |url, idx|
          puts "[HTML5]   Image #{idx + 1}: #{url}"
          if url.match?(/^https?:\/\//)
            puts "[HTML5]     -> Remote URL detected, downloading..."
            begin
              require 'open-uri'
              require 'uri'
              
              uri = URI.parse(url)
              filename = File.basename(uri.path)
              if filename.empty? || !filename.match?(/\.(jpg|jpeg|png|gif|svg|webp)$/i)
                filename = "image_#{url.hash.abs}.jpg"
              end
              
              local_path = File.join(images_dir, filename)
              
              puts "[HTML5]     -> Downloading to: #{local_path}"
              URI.open(url, 'rb') do |remote_file|
                File.open(local_path, 'wb') do |local_file|
                  local_file.write(remote_file.read)
                end
              end
              
              puts "[HTML5]     -> Successfully downloaded (#{File.size(local_path)} bytes)"
              downloaded_images[url] = filename
            rescue => download_error
              puts "[HTML5]     -> WARNING: Failed to download image: #{download_error.message}"
            end
          end
        end
        
        # Replace remote URLs in content with local filenames
        if downloaded_images.any?
          puts "[HTML5] Replacing remote image URLs with local paths in content"
          downloaded_images.each do |remote_url, local_filename|
            old_content = content.dup
            content = content.gsub(/image::?#{Regexp.escape(remote_url)}(\[[^\]]*\])?/i) do |match|
              attributes = $1 || ''
              "image::#{local_filename}#{attributes}"
            end
            if content != old_content
              puts "[HTML5]   Replaced image macro: #{remote_url} -> #{local_filename}"
            end
            
            # Replace in cover image attributes
            docdir = File.dirname(temp_adoc.path)
            relative_image_path = Pathname.new(File.join(images_dir, local_filename)).relative_path_from(Pathname.new(docdir)).to_s
            old_content = content.dup
            content = content.gsub(/^:(?:front-cover-image|epub-cover-image):\s*#{Regexp.escape(remote_url)}\s*$/i, ":front-cover-image: #{relative_image_path}")
            if content != old_content
              puts "[HTML5]   Replaced cover image attribute: #{remote_url} -> #{relative_image_path}"
            end
          end
          
          # Write updated content back to temp file
          File.write(temp_adoc.path, content)
          puts "[HTML5] Updated AsciiDoc file with local image paths"
        end
      end
      
      puts "[HTML5] Conversion timeout: #{CONVERSION_TIMEOUT} seconds"
      # Read the updated content (with local image paths) for cover image extraction
      updated_content = File.read(temp_adoc.path)
      
      # Convert to HTML5 with standalone document
      # Read file content and use convert (not convert_file) to get HTML string directly
      # convert_file returns a Document object, but convert returns the HTML string
      html_content = Timeout.timeout(CONVERSION_TIMEOUT) do
        Asciidoctor.convert(
          updated_content,
          backend: 'html5',
          safe: 'unsafe',
          attributes: {
            'title' => title,
            'author' => author,
            'doctype' => 'book',
            'imagesdir' => all_image_urls.any? ? 'images' : '.',
            'allow-uri-read' => '',
            'stylesheet' => 'default',
            'linkcss' => '',
            'copycss' => '',
            'standalone' => '',
            'noheader' => '',
            'nofooter' => ''
          }
        )
      end
      
      # Embed downloaded images as base64 data URIs for standalone HTML
      if downloaded_images.any? && images_dir && File.directory?(images_dir)
        puts "[HTML5] Embedding images as base64 data URIs"
        require 'base64'
        downloaded_images.each do |remote_url, local_filename|
          local_path = File.join(images_dir, local_filename)
          if File.exist?(local_path)
            begin
              image_data = File.binread(local_path)
              base64_data = Base64.strict_encode64(image_data)
              
              # Determine MIME type from extension
              ext = File.extname(local_filename).downcase
              mime_type = case ext
                          when '.jpg', '.jpeg' then 'image/jpeg'
                          when '.png' then 'image/png'
                          when '.gif' then 'image/gif'
                          when '.svg' then 'image/svg+xml'
                          when '.webp' then 'image/webp'
                          else 'image/jpeg'
                          end
              
              data_uri = "data:#{mime_type};base64,#{base64_data}"
              
              # Replace image src attributes with data URIs
              # Match both <img src="..."> and image references in AsciiDoc-generated HTML
              old_html = html_content.dup
              html_content = html_content.gsub(/src=["']([^"']*#{Regexp.escape(local_filename)}[^"']*)["']/i, "src=\"#{data_uri}\"")
              if html_content != old_html
                puts "[HTML5]   Embedded image: #{local_filename} (#{image_data.bytesize} bytes)"
              end
            rescue => embed_error
              puts "[HTML5]   WARNING: Failed to embed image #{local_filename}: #{embed_error.message}"
            end
          end
        end
      end
      
      # Extract cover image from updated content if present
      cover_image_path = nil
      cover_image_match = updated_content.match(/^:front-cover-image:\s*(.+)$/i)
      if cover_image_match
        cover_image_path = cover_image_match[1].strip
        puts "[HTML5] Found cover image attribute: #{cover_image_path}"
        
        # Check if this cover image was downloaded
        # The path might be a relative path like "images/filename.jpg" or just "filename.jpg"
        cover_image_basename = File.basename(cover_image_path)
        cover_image_local_filename = downloaded_images.values.find { |filename| filename == cover_image_basename }
        
        if cover_image_local_filename
          puts "[HTML5] Cover image was downloaded as: #{cover_image_local_filename}"
          cover_image_path = cover_image_local_filename
        end
      end
      
      # Ensure we have a complete HTML document
      unless html_content.include?('<!doctype') || html_content.include?('<!DOCTYPE')
        html_content = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>#{title}</title>\n</head>\n<body>\n#{html_content}\n</body>\n</html>"
      end
      
      # Add cover image to HTML if present (HTML5 doesn't automatically render :front-cover-image:)
      if cover_image_path
        # Try to find the image in downloaded images or use the path directly
        cover_image_data_uri = nil
        
        # Check if we downloaded this image
        if downloaded_images.any? && images_dir && File.directory?(images_dir)
          # Find the local filename
          local_filename = nil
          downloaded_images.each do |url, filename|
            if filename == File.basename(cover_image_path) || cover_image_path.include?(filename)
              local_filename = filename
              break
            end
          end
          
          if local_filename
            local_path = File.join(images_dir, local_filename)
            if File.exist?(local_path)
              begin
                require 'base64'
                image_data = File.binread(local_path)
                base64_data = Base64.strict_encode64(image_data)
                
                ext = File.extname(local_filename).downcase
                mime_type = case ext
                            when '.jpg', '.jpeg' then 'image/jpeg'
                            when '.png' then 'image/png'
                            when '.gif' then 'image/gif'
                            when '.svg' then 'image/svg+xml'
                            when '.webp' then 'image/webp'
                            else 'image/jpeg'
                            end
                
                cover_image_data_uri = "data:#{mime_type};base64,#{base64_data}"
                puts "[HTML5] Cover image embedded as base64 data URI (#{image_data.bytesize} bytes)"
              rescue => embed_error
                puts "[HTML5] WARNING: Failed to embed cover image: #{embed_error.message}"
              end
            end
          end
        end
        
        # Insert cover image at the beginning of the body
        cover_image_html = if cover_image_data_uri
          "<div style=\"text-align: center; margin: 2em 0;\"><img src=\"#{cover_image_data_uri}\" alt=\"Cover Image\" style=\"max-width: 100%; height: auto; max-width: 500px;\"></div>"
        elsif cover_image_path
          # Use the path directly (might be a relative path)
          "<div style=\"text-align: center; margin: 2em 0;\"><img src=\"#{cover_image_path}\" alt=\"Cover Image\" style=\"max-width: 100%; height: auto; max-width: 500px;\"></div>"
        end
        
        if cover_image_html
          # Insert after <body> tag or at the beginning of body content
          if html_content.include?('<body>')
            html_content = html_content.sub('<body>', "<body>\n#{cover_image_html}")
          elsif html_content.include?('<body')
            # Handle <body with attributes>
            html_content = html_content.sub(/<body[^>]*>/, "\\0\n#{cover_image_html}")
          else
            # No body tag, prepend to content
            html_content = cover_image_html + "\n" + html_content
          end
          puts "[HTML5] Cover image added to HTML"
        end
      end
      
      # Inject custom CSS optimized for e-paper readers (Kindle, Tolino, etc.)
      # E-paper readers have limited CSS support and cannot scroll horizontally
      source_block_css = <<~CSS
        <style>
          /* E-paper reader friendly styles */
          body {
            max-width: 100%;
            margin: 0;
            padding: 1em;
            font-family: serif;
            line-height: 1.6;
          }
          
          /* Images - ensure they fit on e-paper screens */
          img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 1em auto;
          }
          
          /* All code and source blocks - wrap text, no horizontal scroll */
          pre, pre code, .listingblock pre, .literalblock pre, .sourceblock pre {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
            white-space: pre-wrap;
            word-break: break-all;
          }
          
          /* Code blocks - wrap instead of scroll */
          pre code {
            display: block;
            max-width: 100%;
            white-space: pre-wrap;
            word-break: break-all;
          }
          
          /* Blockquotes and quotes - wrap long lines */
          blockquote, .quoteblock, .quote-block {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          blockquote p, .quoteblock p, .quote-block p,
          blockquote div, .quoteblock div, .quote-block div {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          /* Verse blocks (poetry) - wrap text */
          .verseblock, .verse-block {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          .verseblock pre, .verse-block pre {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
            white-space: pre-wrap;
          }
          
          /* Any element with pre-formatted content - wrap */
          [class*="literal"], [class*="listing"], [class*="source"] {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
            white-space: pre-wrap;
          }
          
          /* Tables - make them fit by wrapping or making scrollable if needed */
          table {
            max-width: 100%;
            border-collapse: collapse;
          }
          
          table td, table th {
            overflow-wrap: break-word;
            word-wrap: break-word;
            max-width: 50%;
          }
          
          /* Container constraints */
          .content, #content, [role="main"], main, article, section {
            max-width: 100%;
          }
          
          /* Ensure inline code doesn't break layout */
          code:not(pre code) {
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          /* Headings - ensure they fit */
          h1, h2, h3, h4, h5, h6 {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          
          /* Paragraphs */
          p {
            max-width: 100%;
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
      # Change directory before cleanup to prevent getcwd errors
      safe_chdir_before_cleanup
      temp_adoc.unlink if temp_adoc
    end
  rescue JSON::ParserError => e
    status 400
    content_type :json
    set_cors_headers
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue Timeout::Error => e
    puts "[HTML5] Conversion timed out after #{CONVERSION_TIMEOUT} seconds"
    status 504  # Gateway Timeout
    content_type :json
    set_cors_headers
    {
      error: 'HTML5 conversion timed out',
      message: "Conversion exceeded the maximum time limit of #{CONVERSION_TIMEOUT} seconds",
      hint: 'The document may be too large or complex. Try breaking it into smaller sections, or increase ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable.'
    }.to_json
  rescue => e
    status 500
    content_type :json
    set_cors_headers
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
    
    # Create temporary file for AsciiDoc content in safe location
    temp_adoc = safe_tempfile('document', '.adoc')
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary file for PDF output in safe location
    temp_pdf = safe_tempfile('document', '.pdf')
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
      # Pattern matches: image::url or image:url, optionally followed by [attributes]
      image_urls = content.scan(/image::?([^\s\[\]]+)/i).flatten
      
      # Also scan for inline image macros with attributes: image::url[alt] or image:url[alt]
      # This catches cases where URLs might have been missed
      inline_images = content.scan(/image::?([^\[]+)\[/i).flatten.map { |url| url.strip }
      image_urls = (image_urls + inline_images).uniq
      
      # Also scan for cover image attributes (:front-cover-image: and :epub-cover-image:)
      cover_image_attrs = content.scan(/^:(?:front-cover-image|epub-cover-image):\s*(.+)$/i).flatten
      cover_image_urls = cover_image_attrs.map { |attr| attr.strip }.reject(&:empty?)
      
      # Combine all image URLs (remove duplicates)
      all_image_urls = (image_urls + cover_image_urls).uniq
      downloaded_images = {}  # Map remote URLs to local filenames
      
      # Debug: Log all found image URLs
      if all_image_urls.any?
        puts "[PDF] Found #{all_image_urls.length} image reference(s) in content (#{image_urls.length} from macros, #{cover_image_urls.length} from cover attributes):"
        puts "[PDF] Debug: All image URLs: #{all_image_urls.inspect}"
        
        # Create images directory in temp location (use absolute path)
        temp_dir = File.dirname(temp_adoc.path)
        images_dir = File.join(temp_dir, 'images')
        FileUtils.mkdir_p(images_dir)
        # Use relative path for imagesdir (relative to document directory)
        # Asciidoctor resolves imagesdir relative to the document's directory
        pdf_attributes['imagesdir'] = 'images'
        puts "[PDF] Images directory set to: #{pdf_attributes['imagesdir']} (absolute: #{File.expand_path(images_dir)})"
        
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
        # Debug: Check if there are any image macros in content that weren't detected
        image_macro_count = content.scan(/image::?/i).length
        if image_macro_count > 0
          puts "[PDF] WARNING: Found #{image_macro_count} image macro(s) in content but extracted 0 URLs"
          puts "[PDF] Debug: Sample of content with images: #{content.scan(/image::?[^\n]{0,100}/i).first(3).inspect}"
        else
          puts "[PDF] No image references found in content"
        end
      end
      
      puts "[PDF] Starting conversion: #{temp_adoc.path} -> #{temp_pdf.path}"
      puts "[PDF] Attributes: #{pdf_attributes.inspect}"
      puts "[PDF] Content size: #{content.bytesize} bytes"
      puts "[PDF] Conversion timeout: #{CONVERSION_TIMEOUT} seconds"
      start_time = Time.now
      
      # Convert to PDF using convert_file with to_file
      # Wrap in timeout to prevent stuck conversions
      # Note: asciidoctor-pdf can hang after creating the file, so we also check if file exists
      begin
        result = nil
        file_created = false
        
        # Start conversion in a thread so we can monitor file creation
        conversion_thread = Thread.new do
          begin
            puts "[PDF] Calling Asciidoctor.convert_file..."
            result = Asciidoctor.convert_file(
              temp_adoc.path,
              backend: 'pdf',
              safe: 'unsafe',
              to_file: temp_pdf.path,
              attributes: pdf_attributes
            )
            puts "[PDF] Asciidoctor.convert_file returned: #{result.inspect}"
            file_created = true
          rescue => e
            puts "[PDF] Error in conversion thread: #{e.class.name}: #{e.message}"
            raise e
          end
        end
        
        # Monitor for file creation and completion
        max_wait = CONVERSION_TIMEOUT
        check_interval = 2  # Check every 2 seconds
        waited = 0
        last_size = 0
        stable_count = 0
        
        while waited < max_wait && !file_created
          sleep(check_interval)
          waited += check_interval
          
          if File.exist?(temp_pdf.path)
            current_size = File.size(temp_pdf.path)
            if current_size > 0
              if current_size == last_size
                stable_count += 1
                # File size is stable for 3 checks (6 seconds) - conversion likely done
                if stable_count >= 3
                  puts "[PDF] PDF file exists and size is stable (#{current_size} bytes), conversion appears complete"
                  file_created = true
                  break
                end
              else
                stable_count = 0
                last_size = current_size
                puts "[PDF] PDF file growing: #{current_size} bytes (waited #{waited}s)"
              end
            end
          end
          
          # Check if thread completed
          if !conversion_thread.alive?
            file_created = true
            break
          end
        end
        
        # If we timed out waiting, kill the thread and check if file exists
        if waited >= max_wait && !file_created
          puts "[PDF] Timeout reached (#{max_wait}s), checking if PDF was created..."
          conversion_thread.kill if conversion_thread.alive?
          if File.exist?(temp_pdf.path) && File.size(temp_pdf.path) > 0
            puts "[PDF] PDF file exists despite timeout, proceeding with file"
            file_created = true
          else
            elapsed_time = Time.now - start_time
            puts "[PDF] Conversion timed out after #{elapsed_time.round(2)} seconds and no file created"
            raise Timeout::Error, "PDF conversion timed out after #{CONVERSION_TIMEOUT} seconds"
          end
        end
        
        elapsed_time = Time.now - start_time
        puts "[PDF] Conversion completed in #{elapsed_time.round(2)} seconds"
      rescue Timeout::Error => timeout_error
        elapsed_time = Time.now - start_time
        puts "[PDF] Conversion timed out after #{elapsed_time.round(2)} seconds"
        raise timeout_error
      end
      
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
      puts "[PDF] Reading PDF file from disk..."
      pdf_content = File.binread(temp_pdf.path)
      puts "[PDF] Successfully read #{pdf_content.bytesize} bytes from disk"
      
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
      # Cleanup - change directory before cleanup to prevent getcwd errors
      safe_chdir_before_cleanup
      temp_adoc.unlink if temp_adoc
      temp_pdf.unlink if temp_pdf
    end
  rescue JSON::ParserError => e
    status 400
    content_type :json
    set_cors_headers
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue Timeout::Error => e
    puts "[PDF] Conversion timed out after #{CONVERSION_TIMEOUT} seconds"
    error_details = {
      error: 'PDF conversion timed out',
      message: "Conversion exceeded the maximum time limit of #{CONVERSION_TIMEOUT} seconds",
      hint: 'The document may be too large or complex. Try breaking it into smaller sections, or increase ASCIIDOCTOR_CONVERSION_TIMEOUT environment variable.'
    }
    status 504  # Gateway Timeout
    content_type :json
    set_cors_headers
    error_details.to_json
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


