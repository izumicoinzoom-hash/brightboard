#!/usr/bin/env python3
"""清田自動車 工程管理アプリ — ビルド & FTPデプロイスクリプト

使い方:
    # ドライラン（ビルドのみ、FTPアップロードなし）
    python main.py --dry-run

    # 本番実行（ビルド + FTPアップロード）
    python main.py
"""

import argparse
import ftplib
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

# プロジェクトルート
ROOT_DIR = Path(__file__).resolve().parent
DIST_DIR = ROOT_DIR / "dist"


def load_config():
    """.env からFTP接続情報を読み込む"""
    load_dotenv(ROOT_DIR / ".env")
    return {
        "server": os.getenv("FTP_SERVER", ""),
        "username": os.getenv("FTP_USERNAME", ""),
        "password": os.getenv("FTP_PASSWORD", ""),
        "remote_dir": os.getenv("FTP_REMOTE_DIR", "public_html/"),
    }


def run_build():
    """npm run build を実行"""
    print("=== npm run build ===")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=ROOT_DIR,
        capture_output=False,
    )
    if result.returncode != 0:
        print("ビルドに失敗しました。", file=sys.stderr)
        sys.exit(1)
    print("ビルド完了\n")


def upload_directory(ftp, local_dir, remote_dir):
    """ディレクトリを再帰的にFTPアップロード"""
    for item in sorted(local_dir.iterdir()):
        if item.is_dir():
            dir_name = item.name
            remote_path = f"{remote_dir}{dir_name}/"
            try:
                ftp.mkd(remote_path)
            except ftplib.error_perm:
                pass  # ディレクトリが既に存在する場合
            upload_directory(ftp, item, remote_path)
        else:
            remote_path = f"{remote_dir}{item.name}"
            print(f"  アップロード: {item.relative_to(ROOT_DIR)} -> {remote_path}")
            with open(item, "rb") as f:
                ftp.storbinary(f"STOR {remote_path}", f)


def deploy(config):
    """dist/ の中身をFTPでアップロード"""
    if not DIST_DIR.exists():
        print(f"エラー: {DIST_DIR} が存在しません。先にビルドを実行してください。", file=sys.stderr)
        sys.exit(1)

    server = config["server"]
    username = config["username"]
    password = config["password"]
    remote_dir = config["remote_dir"]

    if not server or not username or not password:
        print(
            "エラー: .env に FTP_SERVER, FTP_USERNAME, FTP_PASSWORD を設定してください。",
            file=sys.stderr,
        )
        sys.exit(1)

    # remote_dir の末尾に / を付ける
    if not remote_dir.endswith("/"):
        remote_dir += "/"

    print(f"=== FTPデプロイ ===")
    print(f"  サーバー: {server}")
    print(f"  ユーザー: {username}")
    print(f"  リモート: {remote_dir}\n")

    ftp = ftplib.FTP(server)
    try:
        ftp.login(username, password)
        print(f"  FTP接続成功\n")
        upload_directory(ftp, DIST_DIR, remote_dir)
        print(f"\nデプロイ完了")
    finally:
        ftp.quit()


def dry_run_report(config):
    """ドライラン: ビルド結果とアップロード対象を表示"""
    if not DIST_DIR.exists():
        print("dist/ が見つかりません。ビルドに失敗した可能性があります。")
        return

    files = list(DIST_DIR.rglob("*"))
    file_count = sum(1 for f in files if f.is_file())
    total_size = sum(f.stat().st_size for f in files if f.is_file())

    print("=== ドライラン結果 ===")
    print(f"  アップロード対象ファイル数: {file_count}")
    print(f"  合計サイズ: {total_size / 1024:.1f} KB\n")

    print("  アップロード対象:")
    for f in sorted(files):
        if f.is_file():
            size = f.stat().st_size
            print(f"    {f.relative_to(DIST_DIR)}  ({size / 1024:.1f} KB)")

    print()
    server = config["server"]
    remote_dir = config["remote_dir"]
    if server:
        print(f"  デプロイ先: {server}:{remote_dir}")
    else:
        print("  注意: .env に FTP_SERVER が未設定です。本番実行前に設定してください。")


def main():
    parser = argparse.ArgumentParser(
        description="清田自動車 工程管理アプリのビルド＆デプロイ"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="ビルドのみ実行し、FTPアップロードは行わない（動作確認用）",
    )
    args = parser.parse_args()

    config = load_config()

    # ビルド
    run_build()

    if args.dry_run:
        dry_run_report(config)
    else:
        deploy(config)


if __name__ == "__main__":
    main()
