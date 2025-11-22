#!/usr/bin/env ruby
require 'sinatra'
require 'puma'
require 'asciidoctor'
require 'asciidoctor-pdf'
require 'asciidoctor-epub3'
require 'asciidoctor-revealjs'
require 'json'
require 'tempfile'
require 'fileutils'
require 'zip'

set :port, ENV.fetch('ASCIIDOCTOR_PORT', 8091).to_i
set :bind, '0.0.0.0'
set :server, 'puma'

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

# Convert to PDF
post '/convert/pdf' do
  begin
    request.body.rewind
    data = JSON.parse(request.body.read)
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
    
    # Create temporary PDF file
    temp_pdf = Tempfile.new(['document', '.pdf'])
    temp_pdf.close
    
    begin
      # Convert to PDF with enhanced attributes for better rendering
      # Use custom classic novel theme if specified, otherwise default
      theme = content.include?(':pdf-theme:') ? nil : 'classic-novel'
      themesdir = content.include?(':pdf-themesdir:') ? nil : '/app/deployment'
      
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
    data = JSON.parse(request.body.read)
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
      
      # Convert to EPUB with enhanced attributes for better rendering
      epub_attributes = {
        'title' => title,
        'author' => author,
        'doctype' => 'book',
        'imagesdir' => '.',  # Allow images from any location
        'allow-uri-read' => '',  # Allow reading images from URLs
        'epub3-cover-image-format' => 'jpg',
        'epub3-stylesdir' => '/app/deployment',
        'stylesheet' => 'epub-classic.css'
      }
      
      if cover_image
        epub_attributes['epub3-cover-image'] = cover_image
      end
      
      # Convert to EPUB
      result = Asciidoctor.convert_file temp_adoc.path,
        backend: 'epub3',
        safe: 'unsafe',
        to_file: epub_file,
        attributes: epub_attributes
      
      # Verify EPUB file was created and exists
      unless File.exist?(epub_file)
        status 500
        return { error: 'EPUB file was not created', debug: "Expected file: #{epub_file}" }.to_json
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
      FileUtils.rm_rf(temp_dir)
    end
  rescue JSON::ParserError => e
    status 400
    { error: 'Invalid JSON', message: e.message }.to_json
  rescue => e
    status 500
    { error: 'Conversion failed', message: e.message }.to_json
  end
end

# Convert to HTML5
post '/convert/html5' do
  begin
    request.body.rewind
    data = JSON.parse(request.body.read)
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
    data = JSON.parse(request.body.read)
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
    endpoints: {
      pdf: '/convert/pdf',
      epub: '/convert/epub',
      html5: '/convert/html5',
      revealjs: '/convert/revealjs',
      latex: '/convert/latex',
      health: '/healthz'
    }
  }.to_json
end

# Convert to LaTeX
post '/convert/latex' do
  begin
    request.body.rewind
    data = JSON.parse(request.body.read)
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

