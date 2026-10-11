package com.wonder.photo;
import org.junit.Test;
import static org.junit.Assert.*;
public class RemoteConnectionTest {
    @Test public void addressesNavigationAndDownloadBoundaries() throws Exception {
        assertEquals("http://192.168.1.20:8000", RemoteConnection.normalize(" http://192.168.1.20:8000/ "));
        assertEquals("http://100.64.1.2:8000", RemoteConnection.normalize("http://100.64.1.2:8000"));
        assertEquals("https://photos.example.com", RemoteConnection.normalize("https://photos.example.com"));
        for (String url : new String[]{"http://8.8.8.8", "http://evil.example", "file:///sdcard/photo.jpg", "https://user:password@example.com", "http://192.168.1.20/path", "http://192.168.1.20?token=x"}) assertThrows(Exception.class, () -> RemoteConnection.normalize(url));
        String base = "http://192.168.1.20:8000";
        assertTrue(RemoteConnection.exportUrl(base, base + "/api/exports/watermark.jpg"));
        assertFalse(RemoteConnection.exportUrl(base, base + "/api/photos/one/original"));
        assertFalse(RemoteConnection.exportUrl(base, "http://evil.example/api/exports/watermark.jpg"));
        assertFalse(RemoteConnection.sameServer(base, "http://192.168.1.20:8000.evil.example"));
    }
}
