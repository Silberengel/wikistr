#!/usr/bin/env ruby
require 'sinatra'
require 'puma'
require 'asciidoctor'
require 'asciidoctor-pdf'
require 'asciidoctor-epub3'
require 'json'
require 'tempfile'
require 'fileutils'

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
      epub: '/convert/epub'
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
      # Convert to PDF
      Asciidoctor.convert_file temp_adoc.path,
        backend: 'pdf',
        safe: 'unsafe',
        to_file: temp_pdf.path,
        attributes: {
          'title' => title,
          'author' => author,
          'doctype' => 'article'
        }
      
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
      # Convert to EPUB
      Asciidoctor.convert_file temp_adoc.path,
        backend: 'epub3',
        safe: 'unsafe',
        to_file: epub_file,
        attributes: {
          'title' => title,
          'author' => author,
          'doctype' => 'book'
        }
      
      # Read EPUB content
      epub_content = File.read(epub_file)
      
      # Set headers
      content_type 'application/epub+zip'
      headers 'Content-Disposition' => "attachment; filename=\"#{title.gsub(/[^a-z0-9]/i, '_')}.epub\""
      
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
      health: '/healthz'
    }
  }.to_json
end

