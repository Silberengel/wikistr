# SSH Connection Troubleshooting

## 🔑 SSH Key Authentication Issues

### **Problem: Permission denied (publickey)**

This means SSH is trying to use key authentication but can't find or validate your key.

### **Solutions:**

#### **Option 1: Check if you have SSH keys**
```bash
# Check if you have SSH keys on your local machine
ls -la ~/.ssh/

# If no keys exist, generate them
ssh-keygen -t ed25519 -C "your-email@example.com"
```

#### **Option 2: Use password authentication (if enabled)**
```bash
# Try with password authentication
ssh -o PreferredAuthentications=password root@217.154.126.125
```

#### **Option 3: Add your SSH key to the server**
```bash
# Copy your public key to the server
ssh-copy-id root@217.154.126.125

# Or manually add the key
cat ~/.ssh/id_ed25519.pub | ssh root@217.154.126.125 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

#### **Option 4: Use existing SSH key**
```bash
# Specify the key file explicitly
ssh -i ~/.ssh/id_rsa root@217.154.126.125
# or
ssh -i ~/.ssh/id_ed25519 root@217.154.126.125
```

## 🛠 Alternative Deployment Methods

### **Method 1: Upload files via SCP with password**
```bash
# Upload files using password authentication
scp -o PreferredAuthentications=password deploy-wikistr.sh root@217.154.126.125:/root/
scp -o PreferredAuthentications=password setup-ssl.sh root@217.154.126.125:/root/
```

### **Method 2: Use Plesk File Manager**
1. Log into Plesk web interface
2. Go to File Manager
3. Upload the deployment files manually
4. SSH in via Plesk terminal (if available)

### **Method 3: Create files directly on server**
SSH into the server and create the files manually:

```bash
# Connect to server (try different methods)
ssh root@217.154.126.125
# or
ssh -o PreferredAuthentications=password root@217.154.126.125
# or
ssh -i ~/.ssh/your_key root@217.154.126.125

# Once connected, create the deployment script
nano /root/deploy-wikistr.sh
# Copy and paste the script content
```

### **Method 4: Use curl/wget to download scripts**
If you can get a temporary connection:

```bash
# On the server, download the scripts from a web location
curl -o /root/deploy-wikistr.sh https://your-temp-server.com/deploy-wikistr.sh
curl -o /root/setup-ssl.sh https://your-temp-server.com/setup-ssl.sh
```

## 🔧 SSH Configuration Debug

### **Check SSH configuration**
```bash
# Verbose SSH connection to see what's happening
ssh -v root@217.154.126.125

# More verbose
ssh -vvv root@217.154.126.125
```

### **Check server SSH configuration**
```bash
# If you can connect via other means, check SSH config
sudo nano /etc/ssh/sshd_config

# Look for these settings:
# PasswordAuthentication yes
# PubkeyAuthentication yes
# AuthorizedKeysFile .ssh/authorized_keys

# Restart SSH service after changes
sudo systemctl restart sshd
```

## 🚀 Quick Manual Deployment

If SSH is problematic, here's a manual deployment approach:

### **Step 1: Access server via Plesk**
1. Log into Plesk web interface
2. Use File Manager to upload files
3. Use Terminal/SSH via Plesk interface

### **Step 2: Manual Docker deployment**
```bash
# On the server, run these commands directly:

# Pull and run wikistr container
docker pull silberengel/wikistr:latest
docker stop wikistr-app 2>/dev/null || true
docker rm wikistr-app 2>/dev/null || true

docker run -d \
  --name wikistr-app \
  --restart unless-stopped \
  -p 127.0.0.1:3000:80 \
  -e NODE_ENV=production \
  silberengel/wikistr:latest

# Test container
curl -f http://127.0.0.1:3000/health
```

### **Step 3: Manual Apache configuration**
```bash
# Create Apache config
sudo tee /etc/apache2/conf-available/wikistr-override.conf << 'EOF'
<VirtualHost *:443>
    ServerName wikistr.imwald.eu
    ServerAlias www.wikistr.imwald.eu
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/wikistr.imwald.eu/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/wikistr.imwald.eu/privkey.pem
    DocumentRoot /var/www/wikistr
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    Header always set X-Forwarded-Proto "https"
    Header always set X-Forwarded-Port "443"
</VirtualHost>

<VirtualHost *:80>
    ServerName wikistr.imwald.eu
    ServerAlias www.wikistr.imwald.eu
    Redirect permanent / https://wikistr.imwald.eu/
</VirtualHost>
EOF

# Enable config and modules
sudo a2enconf wikistr-override
sudo a2enmod proxy proxy_http headers ssl
sudo mkdir -p /var/www/wikistr
sudo systemctl restart apache2
```

## 📞 Getting Help

### **Contact your hosting provider**
- Ask them to enable password authentication for SSH
- Request SSH key setup assistance
- Ask for alternative access methods

### **Check Plesk access**
- Try logging into Plesk web interface
- Use Plesk's built-in SSH terminal
- Check if you have FTP/SFTP access

### **Alternative access methods**
- VNC/RDP if available
- Console access via hosting provider
- Web-based terminal in Plesk

## 🎯 Quick Fix Commands

Try these in order:

```bash
# 1. Try with password
ssh -o PreferredAuthentications=password root@217.154.126.125

# 2. Try with specific key
ssh -i ~/.ssh/id_rsa root@217.154.126.125

# 3. Try with different user (if root is disabled)
ssh admin@217.154.126.125

# 4. Try with port specification
ssh -p 22 root@217.154.126.125

# 5. Try with verbose output to debug
ssh -vvv root@217.154.126.125
```

---

**Once you get SSH access working, you can run the deployment scripts!** 🚀
