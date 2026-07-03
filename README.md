# Google Maps Crawler Desktop

App desktop moi, khong dung backend/web server cu.

## Chay dev

```powershell
cd "C:\Users\Admin\Documents\New project\apps\desktop\google-maps-crawler-desktop"
npm.cmd install
npm.cmd start
```

## Build installer

```powershell
npm.cmd run dist:win
```

Installer nam tai:

```text
release\Google Maps Crawler Desktop Setup 1.0.0.exe
```

## Ghi chu

- App crawl truc tiep Google Maps bang Edge/Chrome, khong can API key.
- Quet theo thanh pho, dia chi trung tam, link Google Maps/toa do, hoac vi tri hien tai gan dung theo IP.
- Khi quet lai cung keyword va cung khu vuc/link/toa do, app keo sau hon so ket qua da co de co gang lay them data moi thay vi ket thuc sau khi gap dong trung.
- Cung keyword nhung doi khu vuc/link/toa do se duoc tinh la mot search moi va quet tu dau cho khu vuc do.
- Co cot `distance_km` tinh khoang cach tu vi tri hien tai hoac toa do/link Maps dang cau hinh.
- Proxy co the paste nhieu dong hoac lay tu URL proxy list. App xoay proxy theo luong.
- Co so luong luong, delay, retry, log hoat dong, tab ket qua theo keyword.
- Co chon nhieu dong, xoa dong, xoa tab hien tai, xoa chien dich.
- Xuat CSV/Excel theo dong/cot dang chon hoac tat ca, co tuy chon xuat xong xoa.
- Link website/Maps mo bang trinh duyet ngoai, khong mo trong app.
- Nut cap nhat mo repo GitHub: https://github.com/chatgptleetuan-alt/GoogleMaps-CrawlbyTom
- Neu Google yeu cau CAPTCHA/xac minh, app se dung va bao log; app khong tu dong vuot CAPTCHA.
- Data luu trong `%APPDATA%\Google Maps Crawler Desktop\data.json`.
