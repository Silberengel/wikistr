#!/usr/bin/env ruby
require 'sinatra'
require 'puma'
require 'rack'
require 'asciidoctor'
require 'asciidoctor-pdf'
require 'asciidoctor-epub3'
require 'asciidoctor-revealjs'
require 'asciidoctor-diagram'  # For PlantUML, Graphviz, BPMN, Mermaid, TikZ, etc.
require 'json'
require 'tempfile'
require 'fileutils'
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

# CORS configuration
before do
  origin = request.env['HTTP_ORIGIN']
  allowed_origins = (ENV['ASCIIDOCTOR_ALLOW_ORIGIN'] || '*').split(',').map(&:strip).reject(&:empty?)
  
  if allowed_origins.include?('*') || (origin && allowed_origins.any? { |pattern| origin.match?(/#{pattern.gsub('*', '.*')}/) })
    headers 'Access-Control-Allow-Origin' => origin || '*'
  end
  
  headers 'Access-Control-Allow-Methods' => 'POST, OPTIONS'
  headers 'Access-Control-Allow-Headers' => 'Content-Type, Origin, Accept'
  headers 'Access-Control-Max-Age' => '86400'
end

options '*' do
  204
end

# Load theme configuration from YAML file
def load_theme_config
  @theme_config ||= begin
    config_path = File.join(File.dirname(__FILE__), '..', 'pdf-themes.yml')
    if File.exist?(config_path)
      YAML.load_file(config_path)
    else
      # Fallback configuration if file doesn't exist
      {
        'themes' => {
          'classic' => { 'server_name' => 'classic-novel' },
          'antique' => { 'server_name' => 'antique-novel' },
          'modern' => { 'server_name' => 'modern-book' },
          'documentation' => { 'server_name' => 'documentation' },
          'scientific' => { 'server_name' => 'scientific' },
          'pop' => { 'server_name' => 'pop-book' },
          'bible-paragraph' => { 'server_name' => 'bible-paragraph' },
          'bible-versed' => { 'server_name' => 'bible-versed' },
          'poster' => { 'server_name' => 'poster' }
        },
        'default' => 'classic'
      }
    end
  end
end

# Get server theme name from client theme name
def get_server_theme_name(client_theme)
  config = load_theme_config
  theme_def = config['themes'][client_theme]
  if theme_def && theme_def['server_name']
    theme_def['server_name']
  else
    # Fallback to default
    default_theme = config['default'] || 'classic'
    config['themes'][default_theme]['server_name']
  end
end

# Health check
get '/healthz' do
  content_type :json
  {
    name: 'wikistr-asciidoctor',
    status: 'ok',
    endpoints: {
      pdf: '/convert/pdf',
      epub: '/convert/epub',
      html5: '/convert/html5',
      revealjs: '/convert/revealjs',
      latex: '/convert/latex'
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
    description: 'AsciiDoctor REST API for converting AsciiDoc content to various formats. All formats support automatic table of contents generation and LaTeX math rendering via stem blocks.',
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
      convert_pdf: {
        method: 'POST',
        path: '/asciidoctor/convert/pdf',
        description: 'Convert AsciiDoc content to PDF with automatic table of contents and LaTeX math support',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content. Supports LaTeX math via stem:[] for inline and [stem] blocks for display math',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author',
            theme: 'string (optional) - PDF theme. Valid values: classic, antique, modern, documentation, scientific, pop, bible-paragraph, bible-versed, poster. Default: classic (maps to classic-novel theme)'
          }
        },
        response: {
          type: 'application/pdf',
          disposition: 'attachment'
        },
        features: {
          table_of_contents: 'Automatic table of contents is generated when :toc: attribute is set (enabled by default)',
          latex_math: 'LaTeX math expressions are supported via AsciiDoc stem blocks. Use stem:[E = mc^2] for inline math or [stem] blocks for display math',
          diagrams: 'Diagram generation is supported via asciidoctor-diagram extension. Supported formats: PlantUML, Graphviz, Mermaid, BPMN (via PlantUML), TikZ (via LaTeX backend)',
          math_examples: {
            inline: 'stem:[E = mc^2]',
            display: '[stem]\n----\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n----'
          },
          diagram_examples: {
            plantuml: '[plantuml]\n----\n@startuml\nAlice -> Bob: Hello\n@enduml\n----',
            graphviz: '[graphviz]\n----\ndigraph G {\n  A -> B\n}\n----',
            mermaid: '[mermaid]\n----\ngraph TD\n  A --> B\n----',
            bpmn: '[plantuml]\n----\n@startbpmn\nstart\n:Process;\nstop\n@endbpmn\n----'
          }
        },
        themes: {
          classic: 'Classic novel style (default)',
          antique: 'Antique book style',
          modern: 'Modern book style',
          documentation: 'Technical documentation style',
          scientific: 'Scientific paper style',
          pop: 'Pop book style',
          'bible-paragraph': 'Bible in paragraph format',
          'bible-versed': 'Bible with verse numbers',
          poster: 'Poster layout style'
        },
        example: {
          request: {
            content: '= My Document\n\nThis is the content.',
            title: 'My Document',
            author: 'John Doe',
            theme: 'classic'
          },
          with_theme: {
            content: '= Bible Verse\n\nJohn 3:16 content here.',
            title: 'Bible Passage',
            author: 'KJV',
            theme: 'bible-paragraph'
          },
          with_math: {
            content: '= Math Document\n\nInline: stem:[E = mc^2]\n\nDisplay:\n[stem]\n----\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n----',
            title: 'Math Document',
            author: 'Author',
            theme: 'scientific'
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
      convert_revealjs: {
        method: 'POST',
        path: '/asciidoctor/convert/revealjs',
        description: 'Convert AsciiDoc content to Reveal.js presentation',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author'
          }
        },
        response: {
          type: 'text/html',
          disposition: 'attachment'
        }
      },
      convert_latex: {
        method: 'POST',
        path: '/asciidoctor/convert/latex',
        description: 'Convert AsciiDoc content to LaTeX with automatic table of contents and LaTeX math support',
        request: {
          type: 'application/json',
          body: {
            content: 'string (required) - AsciiDoc content. Supports LaTeX math via stem:[] for inline and [stem] blocks for display math',
            title: 'string (required) - Document title',
            author: 'string (optional) - Document author'
          }
        },
        response: {
          type: 'text/x-latex',
          disposition: 'attachment'
        },
        features: {
          table_of_contents: 'Automatic table of contents is generated when :toc: attribute is set (enabled by default)',
          latex_math: 'LaTeX math expressions are supported via AsciiDoc stem blocks. Math is rendered natively in LaTeX output',
          diagrams: 'Diagram generation is supported via asciidoctor-diagram extension. TikZ diagrams work best with LaTeX backend. PlantUML, Graphviz, and Mermaid are also supported.'
        }
      }
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
      curl_pdf: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/pdf -H 'Content-Type: application/json' -d '{\"content\":\"= Test\\n\\nHello world\",\"title\":\"Test Document\",\"author\":\"Test Author\",\"theme\":\"classic\"}' --output document.pdf",
      curl_pdf_bible: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/pdf -H 'Content-Type: application/json' -d '{\"content\":\"= John 3:16\\n\\nFor God so loved the world...\",\"title\":\"Bible Passage\",\"author\":\"KJV\",\"theme\":\"bible-paragraph\"}' --output bible.pdf",
      curl_epub: "curl -X POST #{request.scheme}://#{request.host_with_port}/asciidoctor/convert/epub -H 'Content-Type: application/json' -d '{\"content\":\"= Test\\n\\nHello world\",\"title\":\"Test Document\",\"theme\":\"classic\"}' --output document.epub",
      javascript_fetch: "fetch('#{request.scheme}://#{request.host_with_port}/asciidoctor/convert/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '= Test\\n\\nHello world', title: 'Test Document', theme: 'classic' }) })",
      javascript_fetch_with_theme: "fetch('#{request.scheme}://#{request.host_with_port}/asciidoctor/convert/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '= My Book\\n\\nContent here', title: 'My Book', author: 'Author', theme: 'bible-paragraph' }) }).then(r => r.blob()).then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'book.pdf'; a.click(); })"
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
    theme_param = data['theme']
    theme_files = data['theme_files'] || {}
    
    unless content
      status 400
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary directory for theme files if custom themes are provided
    temp_themes_dir = nil
    if theme_files.is_a?(Hash) && !theme_files.empty?
      temp_themes_dir = Dir.mktmpdir('custom-themes-')
      theme_files.each do |filename, file_content|
        # Sanitize filename to prevent directory traversal
        safe_filename = File.basename(filename)
        next unless safe_filename.end_with?('.yml') || safe_filename.end_with?('.yaml')
        
        theme_file_path = File.join(temp_themes_dir, safe_filename)
        File.write(theme_file_path, file_content)
      end
    end
    
    # Create temporary file for AsciiDoc content
    temp_adoc = Tempfile.new(['document', '.adoc'])
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary PDF file
    temp_pdf = Tempfile.new(['document', '.pdf'])
    temp_pdf.close
    
    begin
      # Convert to PDF with enhanced attributes for better rendering
      # Theme mapping from client theme names to server theme files (loaded from YAML)
      
      # Use theme from parameter if provided, otherwise check if already in content, otherwise default
      if theme_param
        theme = get_server_theme_name(theme_param)
      elsif content.include?(':pdf-theme:')
        theme = nil # Content already specifies theme
      else
        # Use default from config
        config = load_theme_config
        default_theme = config['default'] || 'classic'
        theme = get_server_theme_name(default_theme)
      end
      
      # Use custom themes directory if provided, otherwise default
      if temp_themes_dir
        themesdir = temp_themes_dir
      else
        themesdir = content.include?(':pdf-themesdir:') ? nil : '/app/deployment'
      end
      
      attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',  # Allow images from any location
        'allow-uri-read' => '',  # Allow reading images from URLs
        'pdf-page-size' => 'Letter',
        'pdf-page-margin' => '[0.75in, 0.75in, 0.75in, 0.75in]',
        'pdf-page-layout' => 'portrait',
        'pdf-fontsdir' => '/usr/share/fonts',
      }
      
      # Only set theme if not already specified in content
      if theme
        attributes['pdf-theme'] = theme
        attributes['pdf-themesdir'] = themesdir
      end
      
      # Diagrams are automatically registered when asciidoctor-diagram is required
      # Supported: PlantUML, Graphviz, Mermaid, BPMN (via PlantUML), TikZ (via LaTeX)
      
      Asciidoctor.convert_file temp_adoc.path,
        backend: 'pdf',
        safe: 'unsafe',
        to_file: temp_pdf.path,
        attributes: attributes
      
      # Read PDF content
      pdf_content = File.read(temp_pdf.path)
      
      # Set headers
      content_type 'application/pdf'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.pdf\""
      
      pdf_content
    ensure
      temp_adoc.unlink
      temp_pdf.unlink
      # Clean up temporary themes directory
      if temp_themes_dir && Dir.exist?(temp_themes_dir)
        FileUtils.rm_rf(temp_themes_dir)
      end
    end
  rescue JSON::ParserError => e
    status 400
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    status 500
    { error: 'Conversion failed', message: e.message }.to_json
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
    theme_param = data['theme']
    theme_files = data['theme_files'] || {}
    
    unless content
      status 400
      return { error: 'Missing content or asciidoc field' }.to_json
    end
    
    # Create temporary directory for theme files if custom themes are provided
    temp_themes_dir = nil
    if theme_files.is_a?(Hash) && !theme_files.empty?
      temp_themes_dir = Dir.mktmpdir('custom-themes-')
      theme_files.each do |filename, file_content|
        # Sanitize filename to prevent directory traversal
        safe_filename = File.basename(filename)
        next unless safe_filename.end_with?('.yml') || safe_filename.end_with?('.yaml')
        
        theme_file_path = File.join(temp_themes_dir, safe_filename)
        File.write(theme_file_path, file_content)
      end
    end
    
    # Create temporary file for AsciiDoc content
    temp_adoc = Tempfile.new(['document', '.adoc'])
    temp_adoc.write(content)
    temp_adoc.close
    
    # Create temporary directory for EPUB output
    temp_dir = Dir.mktmpdir
    epub_file = File.join(temp_dir, 'document.epub')
    
    begin
      # Extract cover image from content if present
      cover_image = nil
      if content.include?('[cover]') || content.include?('image::')
        # Try to extract image URL from content
        image_match = content.match(/image::([^\[]+)\[/)
        cover_image = image_match[1] if image_match
      end
      
      # EPUB stylesheet selection based on theme
      # Note: EPUB uses CSS stylesheets, not PDF themes
      # For now, use classic.css for all themes (could be extended with theme-specific stylesheets)
      stylesheet = 'epub-classic.css'
      if theme_param
        theme_stylesheet_map = {
          'classic' => 'epub-classic.css',
          'antique' => 'epub-classic.css',
          'modern' => 'epub-classic.css',
          'bible-paragraph' => 'epub-classic.css',
          'bible-versed' => 'epub-classic.css'
        }
        stylesheet = theme_stylesheet_map[theme_param] || 'epub-classic.css'
      end
      
      # Convert to EPUB with enhanced attributes for better rendering
      epub_attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',  # Allow images from any location
        'allow-uri-read' => '',  # Allow reading images from URLs
        'epub3-cover-image-format' => 'jpg',
        'epub3-stylesdir' => '/app/deployment',
        'stylesheet' => stylesheet
      }
      
      if cover_image
        epub_attributes['epub3-cover-image'] = cover_image
      end
      
      # Convert to EPUB
      begin
        result = Asciidoctor.convert_file temp_adoc.path,
          backend: 'epub3',
          safe: 'unsafe',
          to_file: epub_file,
          attributes: epub_attributes
      rescue => e
        # Provide detailed error message for AsciiDoc conversion failures
        error_details = {
          error: 'EPUB conversion failed',
          message: e.message,
          class: e.class.name
        }
        
        # Check if it's an AsciiDoc syntax error
        if e.message.include?('syntax') || e.message.include?('parse') || e.message.include?('invalid')
          error_details[:hint] = 'This appears to be an AsciiDoc syntax error. Please check your document for: unclosed blocks, invalid attribute syntax, or malformed headings.'
        end
        
        # Include line number if available in error message
        if e.message.match(/line\s+(\d+)/i)
          line_num = e.message.match(/line\s+(\d+)/i)[1]
          error_details[:line] = line_num.to_i
          error_details[:hint] = "Error detected around line #{line_num}. Please check the AsciiDoc syntax at that location."
        end
        
        status 500
        return error_details.to_json
      end
      
      # Verify EPUB file was created and exists
      unless File.exist?(epub_file)
        status 500
        return { error: 'EPUB file was not created', debug: "Expected file: #{epub_file}", hint: 'The conversion completed but no EPUB file was generated. This may indicate an AsciiDoc syntax error or missing content.' }.to_json
      end
      
      # Check file size
      file_size = File.size(epub_file)
      if file_size == 0
        status 500
        return { error: 'Generated EPUB file is empty' }.to_json
      end
      
      # Verify it's a valid ZIP file (EPUB is a ZIP archive)
      # Check for ZIP magic bytes
      begin
        File.open(epub_file, 'rb') do |f|
          magic = f.read(4)
          unless magic == "PK\x03\x04"  # ZIP file signature
            status 500
            return { error: 'Generated file is not a valid ZIP/EPUB', magic: magic.unpack('H*').first }.to_json
          end
        end
        
        # Verify ZIP structure using rubyzip
        require 'zip'
        Zip::File.open(epub_file) do |zip_file|
          # Check for required EPUB files
          unless zip_file.find_entry('META-INF/container.xml')
            status 500
            return { error: 'Generated EPUB is missing required META-INF/container.xml' }.to_json
          end
        end
      rescue Zip::Error => e
        status 500
        return { error: 'Generated EPUB is not a valid ZIP file', message: e.message }.to_json
      rescue => e
        status 500
        return { error: 'Failed to validate EPUB file', message: e.message }.to_json
      end
      
      # Read EPUB content as binary
      epub_content = File.binread(epub_file)
      
      # Verify file is not empty (double check)
      if epub_content.nil? || epub_content.empty?
        status 500
        return { error: 'Generated EPUB file is empty after reading' }.to_json
      end
      
      # Set headers before sending binary content
      content_type 'application/epub+zip'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.epub\""
      headers 'Content-Length' => epub_content.bytesize.to_s
      
      # Return binary content
      epub_content
    ensure
      temp_adoc.unlink
      FileUtils.rm_rf(temp_dir) if temp_dir
      # Clean up temporary themes directory
      if temp_themes_dir && Dir.exist?(temp_themes_dir)
        FileUtils.rm_rf(temp_themes_dir)
      end
    end
  rescue JSON::ParserError => e
    status 400
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    # Provide detailed error information for EPUB conversion
    error_details = {
      error: 'EPUB conversion failed',
      message: e.message,
      class: e.class.name
    }
    
    # Check if it's an AsciiDoc syntax error
    if e.message.include?('syntax') || e.message.include?('parse') || e.message.include?('invalid') || e.message.include?('AsciiDoc')
      error_details[:hint] = 'This appears to be an AsciiDoc syntax error. Common issues include: unclosed blocks (----), invalid attribute syntax, malformed headings, or incorrect attribute block spacing (attribute blocks like [abstract], [discrete], etc. should be followed directly by the heading without a blank line).'
    end
    
    # Include backtrace for debugging (first few lines only)
    if e.backtrace && e.backtrace.length > 0
      error_details[:backtrace] = e.backtrace.first(3)
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

# Convert to Reveal.js presentation
post '/convert/revealjs' do
  begin
    request.body.rewind
    body_content = request.body.read
    log_request_size(body_content, 'RevealJS')
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
      # Convert to Reveal.js
      html_content = Asciidoctor.convert content,
        backend: 'revealjs',
        safe: 'unsafe',
        attributes: {
          'title' => title,
          'author' => author,
          'doctype' => 'article',
          'imagesdir' => '.',
          'allow-uri-read' => '',
          'revealjsdir' => 'https://cdn.jsdelivr.net/npm/reveal.js@4.3.1',
          'revealjs_theme' => 'white',
          'revealjs_transition' => 'slide'
        }
      
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

# Root endpoint
get '/' do
  content_type :json
  {
    name: 'wikistr-asciidoctor',
    status: 'ok',
    version: '1.0.0',
    message: 'Visit /api for REST API documentation',
    endpoints: {
      pdf: '/convert/pdf',
      epub: '/convert/epub',
      html5: '/convert/html5',
      revealjs: '/convert/revealjs',
      latex: '/convert/latex',
      health: '/healthz',
      api_docs: '/api'
    }
  }.to_json
end

# Convert to LaTeX
post '/convert/latex' do
  begin
    request.body.rewind
    body_content = request.body.read
    log_request_size(body_content, 'LaTeX')
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
      # Convert to LaTeX
      latex_content = Asciidoctor.convert content,
        backend: 'latex',
        safe: 'unsafe',
        attributes: {
          'title' => title,
          'author' => author,
          'doctype' => 'article',
          'imagesdir' => '.',
          'allow-uri-read' => ''
        }
      
      # Set headers
      content_type 'text/x-latex; charset=utf-8'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.tex\""
      
      latex_content
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

