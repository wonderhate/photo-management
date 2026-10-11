package com.wonder.photo;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

final class RemoteConnection {
    static String normalize(String address) throws Exception {
        URI uri = new URI(address.trim());
        String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new Exception("请填写完整电脑地址，例如 http://192.168.1.20:8000");
        boolean local = host.equals("localhost") || host.equals("[::1]");
        String[] parts = host.split("\\.");
        if (host.matches("[0-9.]+") && parts.length == 4) {
            int[] n = new int[4];
            for (int i = 0; i < 4; i++) { n[i] = Integer.parseInt(parts[i]); if (n[i] < 0 || n[i] > 255) throw new Exception("IP 地址无效"); }
            local = n[0] == 10 || n[0] == 127 || (n[0] == 192 && n[1] == 168) || (n[0] == 172 && n[1] >= 16 && n[1] <= 31) || (n[0] == 100 && n[1] >= 64 && n[1] <= 127);
        }
        if (!("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && local))) throw new Exception("HTTP 仅用于局域网 / 私有 VPN；公网连接需 HTTPS");
        if (uri.getPort() == 0 || uri.getPort() > 65535) throw new Exception("端口无效");
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }
    static boolean sameServer(String server, String target) {
        try {
            URI base = new URI(server), uri = new URI(target);
            return !server.isEmpty() && base.getScheme().equals(uri.getScheme()) && base.getRawAuthority().equals(uri.getRawAuthority()) && uri.getUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
    static boolean exportUrl(String server, String target) {
        try { return sameServer(server, target) && new URI(target).getPath().matches("/api/exports/[^/]+") && new URI(target).getQuery() == null; }
        catch (Exception ignored) { return false; }
    }
    static HttpURLConnection open(String url, String cookie) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(120000);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", "PhotoCollectionRemote/2");
        connection.setRequestProperty("Cache-Control", "no-store");
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        return connection;
    }
}
